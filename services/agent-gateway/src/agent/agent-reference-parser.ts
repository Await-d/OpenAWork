import { existsSync, readFileSync } from 'node:fs';

export function readReferenceFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  return readFileSync(filePath, 'utf8');
}

export function extractBlockDescription(
  content: string | undefined,
  block: string,
): string | undefined {
  if (!content) {
    return undefined;
  }
  const quoted = content.match(
    new RegExp(`${block}:\\s*\\{[\\s\\S]*?description:\\s*"([^"]+)"`, 'm'),
  );
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  const templated = content.match(
    new RegExp(`${block}:\\s*\\{[\\s\\S]*?description:\\s*\x60([\\s\\S]*?)\x60`, 'm'),
  );
  return templated?.[1]?.trim();
}

export function extractQuotedDescription(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }
  const quoted = content.match(/description:\s*"([^"]+)"/m);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  const templated = content.match(/description:\s*`([\s\S]*?)`/m);
  return templated?.[1]?.trim();
}

export function extractNamedTemplate(
  content: string | undefined,
  name: string,
): string | undefined {
  if (!content) {
    return undefined;
  }
  const match = content.match(
    new RegExp(`(?:const|export const)\\s+${name}\\s*=\\s*\x60([\\s\\S]*?)\x60`, 'm'),
  );
  return match?.[1]?.trim();
}

export function extractInlinePrompt(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }
  const match = content.match(/prompt:\s*`([\s\S]*?)`\s*,/m);
  return match?.[1]?.trim();
}

export function extractPromptVariable(
  content: string | undefined,
  variableName: string,
): string | undefined {
  if (!content) {
    return undefined;
  }
  const match = content.match(
    new RegExp(`const\\s+${variableName}\\s*=\\s*\x60([\\s\\S]*?)\x60`, 'm'),
  );
  return match?.[1]?.trim();
}

export function extractReturnedTemplate(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }
  const match = content.match(/return\s+`([\s\S]*?)`;/m);
  return match?.[1]?.trim();
}
