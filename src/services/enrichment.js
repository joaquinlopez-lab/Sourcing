import {
  classifyDepartmentType,
  classifyPositionType,
  classifyGovernmentLevel,
  normalizeState,
} from '../utils/constants.js';

/** Returns a new enriched official object without mutating the input. */
export function enrichOfficial(official) {
  const textBlob = `${official.title || ''} ${official.department || ''} ${official.description || ''}`;

  return {
    ...official,
    department_type: official.department_type || classifyDepartmentType(official.title, official.department),
    position_type: official.position_type || classifyPositionType(official.title),
    government_level: official.government_level || classifyGovernmentLevel(textBlob, official.website),
    state: normalizeState(official.state),
    linkedin_url: official.linkedin_url ||
      (official.name
        ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(official.name + ' ' + (official.municipality || ''))}`
        : null),
  };
}
