// SPDX-License-Identifier: MPL-2.0
export {
  parseResidueSelection,
  ResidueSelectionParseError,
  type ResidueRangeSelection,
  type ResidueReference,
  type ResidueSelectionParseErrorCode,
  type ResidueSelectionTerm,
  type SingleResidueSelection,
} from './residueSelectionParser';
export {
  resolveResidueSelection,
  type ResolvedResidueTarget,
} from './resolveResidueSelection';
