#!/usr/bin/env node
// TDD Reminder — reminds to write tests first when new features are detected

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = data.prompt || data.content || input;
    checkForNewFeature(prompt);
  } catch (e) {
    checkForNewFeature(input.trim());
  }
});

function checkForNewFeature(prompt) {
  if (!prompt) return;

  const newFeaturePatterns = [
    // German
    /\b(bau|erstell|mach|füg|implementier|programmier)\b.*\b(mir|eine?n?|das|die|der)\b/i,
    /\bneue?[sr]?\s+(feature|seite|page|component|funktion|api|endpoint)/i,
    /\bich (will|möchte|brauche)\b.*\b(haben|bauen|erstellen)\b/i,
    // English
    /\b(build|create|add|implement|make)\b.*\b(a|an|the|new)\b/i,
    /\bnew\s+(feature|page|component|function|api|endpoint|route)/i,
    /\bi (want|need)\b.*\b(to have|to build|to create)\b/i
  ];

  const isNewFeature = newFeaturePatterns.some(p => p.test(prompt));

  if (isNewFeature) {
    console.error('[TDD] 🧪 Neues Feature erkannt — Reminder: Tests ZUERST schreiben, dann implementieren.');
    console.error('[TDD]    1. Schreibe einen Test der beschreibt was das Feature können soll');
    console.error('[TDD]    2. Lasse den Test laufen (er sollte fehlschlagen)');
    console.error('[TDD]    3. Implementiere das Feature bis der Test besteht');
  }
}
