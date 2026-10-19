// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { REVIEW_PROMPT_STORAGE_KEY, ReviewPromptSchedule } from '../../src/ui/reviewPrompt';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 1, 12);

function setup() {
  let now = START;
  const values: Record<string, unknown> = {};
  const storage = {
    get: vi.fn(async () => structuredClone(values)),
    set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, structuredClone(next)); }),
  };
  const create = () => new ReviewPromptSchedule(storage, () => now);
  return { values, storage, create, at: (days: number) => { now = START + days * DAY; } };
}

async function becomeEligible(fixture: ReturnType<typeof setup>, schedule: ReviewPromptSchedule) {
  for (const day of [0, 1, 2, 3]) {
    fixture.at(day);
    expect(await schedule.recordSuccessfulUse()).toBe(false);
  }
  fixture.at(7);
  expect(await schedule.recordSuccessfulUse()).toBe(true);
}

describe('ReviewPromptSchedule', () => {
  it('does not store anything or prompt merely when a panel is opened', () => {
    const { create, storage } = setup();
    create();
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('requires both seven days and five distinct successful-use days', async () => {
    const fixture = setup();
    const schedule = fixture.create();
    for (let use = 0; use < 20; use++) expect(await schedule.recordSuccessfulUse()).toBe(false);
    fixture.at(8);
    expect(await schedule.recordSuccessfulUse()).toBe(false);
    fixture.at(9);
    expect(await schedule.recordSuccessfulUse()).toBe(false);
    fixture.at(10);
    expect(await schedule.recordSuccessfulUse()).toBe(false);
    fixture.at(11);
    expect(await schedule.recordSuccessfulUse()).toBe(true);
    expect(fixture.values[REVIEW_PROMPT_STORAGE_KEY]).toEqual({
      firstUsedAt: START, lastUsedDay: '2026-10-12', activeDays: 5,
      promptCount: 1, nextPromptAt: START + 41 * DAY, dismissed: false,
    });
  });

  it('does not show early even when five active days have accumulated', async () => {
    const fixture = setup();
    const schedule = fixture.create();
    for (let day = 0; day < 7; day++) {
      fixture.at(day);
      expect(await schedule.recordSuccessfulUse()).toBe(false);
    }
    fixture.at(7);
    expect(await schedule.recordSuccessfulUse()).toBe(true);
  });

  it('persists a 30-day cooldown across ignored banners, Later and panel reopenings', async () => {
    const fixture = setup();
    const schedule = fixture.create();
    await becomeEligible(fixture, schedule);
    expect(await schedule.recordSuccessfulUse()).toBe(false);
    schedule.later();
    expect(await schedule.recordSuccessfulUse()).toBe(false);
    const reopened = fixture.create();
    fixture.at(36);
    expect(await reopened.recordSuccessfulUse()).toBe(false);
    fixture.at(37);
    expect(await reopened.recordSuccessfulUse()).toBe(true);
    reopened.later();
    fixture.at(100);
    expect(await fixture.create().recordSuccessfulUse()).toBe(false);
  });

  it('permanently respects opt-out / opening the store across panel reopenings', async () => {
    const fixture = setup();
    const schedule = fixture.create();
    await becomeEligible(fixture, schedule);
    await schedule.dismiss();
    fixture.at(100);
    expect(await fixture.create().recordSuccessfulUse()).toBe(false);
    expect(fixture.values[REVIEW_PROMPT_STORAGE_KEY]).toMatchObject({ dismissed: true });
  });

  it('serializes rapid successful loads so a banner is offered only once', async () => {
    const fixture = setup();
    const schedule = fixture.create();
    await becomeEligible(fixture, schedule);
    schedule.later();
    fixture.at(37);
    expect(await Promise.all(Array.from({ length: 20 }, () => schedule.recordSuccessfulUse())))
      .toEqual([true, ...Array<boolean>(19).fill(false)]);
    expect(fixture.values[REVIEW_PROMPT_STORAGE_KEY]).toMatchObject({ promptCount: 2 });
  });

  it('does not count a clock moving backwards as another day', async () => {
    const fixture = setup();
    const schedule = fixture.create();
    await schedule.recordSuccessfulUse();
    fixture.at(-1);
    expect(await schedule.recordSuccessfulUse()).toBe(false);
    fixture.at(0);
    expect(await schedule.recordSuccessfulUse()).toBe(false);
    expect(fixture.values[REVIEW_PROMPT_STORAGE_KEY]).toMatchObject({ activeDays: 1 });
  });

  it('resets invalid saved values conservatively and never prompts immediately', async () => {
    for (const value of [null, 'bad', { firstUsedAt: -1 }, {
      firstUsedAt: 0, lastUsedDay: 'bad', activeDays: 20,
      promptCount: 0, nextPromptAt: 0, dismissed: false,
    }]) {
      const fixture = setup();
      fixture.values[REVIEW_PROMPT_STORAGE_KEY] = value;
      expect(await fixture.create().recordSuccessfulUse()).toBe(false);
      expect(fixture.values[REVIEW_PROMPT_STORAGE_KEY]).toMatchObject({ firstUsedAt: START, activeDays: 1 });
    }
  });

  it('does not offer a banner if its cooldown cannot be saved', async () => {
    const fixture = setup();
    const schedule = fixture.create();
    for (const day of [0, 1, 2, 3]) {
      fixture.at(day);
      await schedule.recordSuccessfulUse();
    }
    fixture.at(7);
    fixture.storage.set.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(schedule.recordSuccessfulUse()).rejects.toThrow('Storage unavailable');
    expect(await schedule.recordSuccessfulUse()).toBe(false);
  });

  it('cannot show a banner after the panel has been disposed', async () => {
    const fixture = setup();
    const schedule = fixture.create();
    await becomeEligible(fixture, schedule);
    schedule.later();
    fixture.at(37);
    const pending = schedule.recordSuccessfulUse();
    schedule.dispose();
    expect(await pending).toBe(false);
  });
});
