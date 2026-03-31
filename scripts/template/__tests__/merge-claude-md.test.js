const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseSections, mergeCLAUDEmd } = require('../merge-claude-md');

describe('parseSections', () => {
  it('extracts template sections from markers', () => {
    const content = `# Project
<!-- CORTEX:WICHTIG:START -->
## WICHTIG
rule 1
<!-- CORTEX:WICHTIG:END -->
some project content
<!-- CORTEX:REFS:START -->
## References
ref 1
<!-- CORTEX:REFS:END -->`;

    const result = parseSections(content);
    assert.strictEqual(result.template.length, 2);
    assert.strictEqual(result.template[0].name, 'WICHTIG');
    assert.ok(result.template[0].content.includes('rule 1'));
    assert.ok(result.project.includes('some project content'));
  });
});

describe('mergeCLAUDEmd', () => {
  it('replaces template sections while preserving project sections', () => {
    const current = `# My Project
<!-- CORTEX:WICHTIG:START -->
## WICHTIG
old rule
<!-- CORTEX:WICHTIG:END -->

## My Custom Section
my stuff

<!-- CORTEX:REFS:START -->
## References
old refs
<!-- CORTEX:REFS:END -->`;

    const template = `# [Projektname]
<!-- CORTEX:WICHTIG:START -->
## WICHTIG
NEW rule
<!-- CORTEX:WICHTIG:END -->

<!-- CORTEX:REFS:START -->
## References
NEW refs
<!-- CORTEX:REFS:END -->`;

    const result = mergeCLAUDEmd(current, template);
    assert.ok(result.includes('NEW rule'), 'template section should be updated');
    assert.ok(result.includes('NEW refs'), 'template section should be updated');
    assert.ok(result.includes('My Custom Section'), 'project section should be preserved');
    assert.ok(result.includes('my stuff'), 'project content should be preserved');
    assert.ok(result.includes('# My Project'), 'project header should be preserved');
    assert.ok(!result.includes('old rule'), 'old template content should be gone');
  });

  it('adds new template sections that dont exist in current', () => {
    const current = `# My Project
<!-- CORTEX:WICHTIG:START -->
## WICHTIG
rule
<!-- CORTEX:WICHTIG:END -->

<!-- CORTEX:WICHTIG_REPEAT:START -->
## WICHTIG (Wiederholung)
repeat
<!-- CORTEX:WICHTIG_REPEAT:END -->`;

    const template = `# [Projektname]
<!-- CORTEX:WICHTIG:START -->
## WICHTIG
rule
<!-- CORTEX:WICHTIG:END -->

<!-- CORTEX:NEWSTUFF:START -->
## New Section
new content
<!-- CORTEX:NEWSTUFF:END -->

<!-- CORTEX:WICHTIG_REPEAT:START -->
## WICHTIG (Wiederholung)
repeat
<!-- CORTEX:WICHTIG_REPEAT:END -->`;

    const result = mergeCLAUDEmd(current, template);
    assert.ok(result.includes('new content'), 'new section should be added');
    assert.ok(result.includes('CORTEX:NEWSTUFF:START'), 'new markers should be present');
  });
});
