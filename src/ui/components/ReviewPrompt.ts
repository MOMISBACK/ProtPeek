// SPDX-License-Identifier: MPL-2.0
import { logger } from '../../utils/logger';
import type { ReviewPromptSchedule } from '../reviewPrompt';
import { button, element, setHidden } from './dom';

export class ReviewPrompt {
  readonly element = element('aside', { className: 'review-prompt' });
  readonly #schedule: ReviewPromptSchedule;
  #disposed = false;

  constructor(schedule: ReviewPromptSchedule, openReview: () => Promise<unknown>) {
    this.#schedule = schedule;
    this.element.setAttribute('aria-label', 'Share your experience with ProtPeek');
    const review = button('Leave a review', { className: 'review-prompt-primary' });
    const later = button('Later');
    const dismiss = button("Don't ask again");
    const actions = element('div', { className: 'review-prompt-actions' }, [review, later, dismiss]);
    this.element.append(
      element('p', { text: 'Share your experience with ProtPeek.' }),
      actions,
    );
    setHidden(this.element, true);
    review.addEventListener('click', () => {
      review.disabled = true;
      void openReview().then(() => {
        setHidden(this.element, true);
        return this.#schedule.dismiss();
      }).catch((error: unknown) => {
        review.disabled = false;
        logger.warn('Could not open or save the review request', error);
      });
    });
    later.addEventListener('click', () => {
      this.#schedule.later();
      setHidden(this.element, true);
    });
    dismiss.addEventListener('click', () => {
      setHidden(this.element, true);
      void this.#schedule.dismiss().catch((error: unknown) =>
        logger.warn('Could not save the review preference', error),
      );
    });
  }

  recordSuccessfulUse(): void {
    void this.#schedule.recordSuccessfulUse().then((show) => {
      if (show && !this.#disposed) setHidden(this.element, false);
    }).catch((error: unknown) => logger.warn('Could not schedule a review request', error));
  }

  dispose(): void {
    this.#disposed = true;
    this.#schedule.dispose();
    setHidden(this.element, true);
  }
}
