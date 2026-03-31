/**
 * merge-claude-md.js
 *
 * Parses and merges CLAUDE.md files using CORTEX section markers.
 * Template-owned sections (wrapped in markers) can be updated from
 * the upstream template, while project-owned sections stay untouched.
 */

const MARKER_REGEX = /<!-- CORTEX:([A-Z_]+):START -->\n([\s\S]*?)<!-- CORTEX:\1:END -->/g;

/**
 * Parse a CLAUDE.md file into template sections (marked) and project content (unmarked).
 *
 * @param {string} content - The full CLAUDE.md content
 * @returns {{ template: Array<{name: string, content: string}>, project: string }}
 */
function parseSections(content) {
  const template = [];
  let project = content;

  // Extract all marked template sections
  let match;
  while ((match = MARKER_REGEX.exec(content)) !== null) {
    const name = match[1];
    const sectionContent = match[2];
    template.push({ name, content: sectionContent });
  }

  // Remove template sections (including markers) to get project-only content
  project = content.replace(MARKER_REGEX, '').trim();

  return { template, project };
}

/**
 * Merge a current project CLAUDE.md with a template CLAUDE.md.
 * - Template sections (inside markers) get replaced with the template version.
 * - Project sections (outside markers) stay untouched.
 * - New template sections that don't exist in current get inserted before WICHTIG_REPEAT.
 *
 * @param {string} currentContent - The project's current CLAUDE.md
 * @param {string} templateContent - The upstream template's CLAUDE.md
 * @returns {string} - The merged CLAUDE.md
 */
function mergeCLAUDEmd(currentContent, templateContent) {
  // Parse template sections from the upstream template
  const templateSections = {};
  let match;
  const templateRegex = /<!-- CORTEX:([A-Z_]+):START -->\n([\s\S]*?)<!-- CORTEX:\1:END -->/g;
  while ((match = templateRegex.exec(templateContent)) !== null) {
    templateSections[match[1]] = match[2];
  }

  // Find which sections already exist in the current content
  const currentRegex = /<!-- CORTEX:([A-Z_]+):START -->\n[\s\S]*?<!-- CORTEX:\1:END -->/g;
  const existingSections = new Set();
  while ((match = currentRegex.exec(currentContent)) !== null) {
    existingSections.add(match[1]);
  }

  // Step 1: Replace existing template sections in current with the template version
  let result = currentContent.replace(
    /<!-- CORTEX:([A-Z_]+):START -->\n[\s\S]*?<!-- CORTEX:\1:END -->/g,
    (fullMatch, sectionName) => {
      if (templateSections[sectionName] !== undefined) {
        return `<!-- CORTEX:${sectionName}:START -->\n${templateSections[sectionName]}<!-- CORTEX:${sectionName}:END -->`;
      }
      // Section not in template anymore, keep as-is
      return fullMatch;
    }
  );

  // Step 2: Insert new template sections that don't exist in current
  // They get inserted before the WICHTIG_REPEAT section
  for (const [name, content] of Object.entries(templateSections)) {
    if (!existingSections.has(name)) {
      const newBlock = `<!-- CORTEX:${name}:START -->\n${content}<!-- CORTEX:${name}:END -->`;
      const insertPoint = '<!-- CORTEX:WICHTIG_REPEAT:START -->';

      if (result.includes(insertPoint)) {
        result = result.replace(insertPoint, `${newBlock}\n\n${insertPoint}`);
      } else {
        // Fallback: append at the end
        result = result + '\n\n' + newBlock;
      }
    }
  }

  return result;
}

module.exports = { parseSections, mergeCLAUDEmd };
