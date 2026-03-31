/**
 * Deep-merge two settings.json objects.
 *
 * Rules:
 * - env: template values win, project additions preserved
 * - permissions.allow/deny/ask: union of arrays, no duplicates
 * - hooks: merge by event name, deduplicate by command string
 * - scalars (cleanupPeriodDays, attribution, worktree): template wins if project doesn't have it;
 *   if project already has a value, project keeps it (user chose that value)
 */

/**
 * Merge two arrays, removing duplicates (by strict equality on JSON-serialized items
 * for objects, or direct equality for primitives).
 */
function unionArrays(a, b) {
  const seen = new Set(a.map((item) => (typeof item === 'object' ? JSON.stringify(item) : item)));
  const result = [...a];
  for (const item of b) {
    const key = typeof item === 'object' ? JSON.stringify(item) : item;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Collect all unique command strings from a hooks event array.
 * The settings.json hooks structure is:
 *   { EventName: [ { hooks: [ { type, command }, ... ] }, ... ] }
 *
 * We deduplicate by the `command` field across all entries.
 */
function collectCommands(entries) {
  const commands = new Set();
  for (const entry of entries) {
    if (entry && Array.isArray(entry.hooks)) {
      for (const hook of entry.hooks) {
        if (hook && hook.command) {
          commands.add(hook.command);
        }
      }
    }
  }
  return commands;
}

/**
 * Merge hooks for a single event name. Deduplicates by command string.
 * Returns a merged array of hook entries.
 */
function mergeHookEvent(currentEntries, templateEntries) {
  const current = currentEntries || [];
  const template = templateEntries || [];

  // Collect all existing commands from current
  const existingCommands = collectCommands(current);

  // Start with all current entries
  const result = [...current];

  // Add template entries whose commands don't already exist
  for (const entry of template) {
    if (entry && Array.isArray(entry.hooks)) {
      const newHooks = entry.hooks.filter(
        (hook) => hook && hook.command && !existingCommands.has(hook.command)
      );
      if (newHooks.length > 0) {
        // Add as a new entry with only the non-duplicate hooks
        result.push({ ...entry, hooks: newHooks });
      }
    }
  }

  return result;
}

/**
 * Merge two permissions objects. Each key (allow, deny, ask) is unioned as an array.
 */
function mergePermissions(current, template) {
  const result = { ...current };
  for (const key of Object.keys(template)) {
    const currentArr = Array.isArray(result[key]) ? result[key] : [];
    const templateArr = Array.isArray(template[key]) ? template[key] : [];
    result[key] = unionArrays(currentArr, templateArr);
  }
  return result;
}

/**
 * Merge two hooks objects. Each key is an event name whose value is an array of hook entries.
 */
function mergeHooks(current, template) {
  const result = { ...current };
  for (const eventName of Object.keys(template)) {
    result[eventName] = mergeHookEvent(result[eventName], template[eventName]);
  }
  return result;
}

/**
 * Merge two env objects. Template values win for shared keys; project-only keys are preserved.
 */
function mergeEnv(current, template) {
  return { ...current, ...template };
}

// Keys that receive special merge treatment
const SPECIAL_KEYS = new Set(['env', 'permissions', 'hooks']);

/**
 * Main merge function.
 *
 * @param {object} current  - The project's current settings.json content
 * @param {object} template - The template's settings.json content
 * @returns {object} Merged settings
 */
function mergeSettings(current, template) {
  const result = { ...current };

  for (const key of Object.keys(template)) {
    if (key === 'env') {
      result.env = mergeEnv(result.env || {}, template.env || {});
    } else if (key === 'permissions') {
      result.permissions = mergePermissions(result.permissions || {}, template.permissions || {});
    } else if (key === 'hooks') {
      result.hooks = mergeHooks(result.hooks || {}, template.hooks || {});
    } else {
      // Scalar / other keys: project value wins if it already exists
      if (!(key in result)) {
        result[key] = template[key];
      }
    }
  }

  return result;
}

module.exports = { mergeSettings };
