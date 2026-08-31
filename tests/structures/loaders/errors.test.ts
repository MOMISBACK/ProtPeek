// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  StructureLoadError,
  toStructureLoadError,
} from '../../../src/structures/loaders/errors';

describe('StructureLoadError', () => {
  it('exposes stable name, code, message, and cause', () => {
    const cause = new Error('underlying');
    const error = new StructureLoadError('invalid-file', 'Bad structure', {
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      cause,
      code: 'invalid-file',
      message: 'Bad structure',
      name: 'StructureLoadError',
    });
  });
});

describe('toStructureLoadError', () => {
  it('preserves an existing domain error by identity', () => {
    const error = new StructureLoadError('not-found', 'Missing');
    expect(toStructureLoadError(error)).toBe(error);
  });

  it('maps AbortError DOMExceptions to cancellation', () => {
    const cause = new DOMException('The operation was aborted', 'AbortError');

    expect(toStructureLoadError(cause)).toMatchObject({
      cause,
      code: 'aborted',
      name: 'StructureLoadError',
    });
  });

  it.each([new TypeError('offline'), 'unknown rejection', null])(
    'maps an unknown failure to network while retaining its cause',
    (cause) => {
      expect(toStructureLoadError(cause)).toMatchObject({
        cause,
        code: 'network',
        name: 'StructureLoadError',
      });
    },
  );
});

