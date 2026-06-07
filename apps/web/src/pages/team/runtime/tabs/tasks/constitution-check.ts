export interface ConstitutionWarning {
  clause: string;
  status: 'pass' | 'warning' | 'conflict';
  note: string;
}

function isConstitutionWarning(value: unknown): value is ConstitutionWarning {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { clause?: unknown }).clause === 'string' &&
    typeof (value as { note?: unknown }).note === 'string' &&
    ((value as { status?: unknown }).status === 'pass' ||
      (value as { status?: unknown }).status === 'warning' ||
      (value as { status?: unknown }).status === 'conflict')
  );
}

export function readConstitutionWarnings(resultJson: unknown): ConstitutionWarning[] {
  if (
    typeof resultJson !== 'object' ||
    resultJson === null ||
    Array.isArray(resultJson) ||
    !Array.isArray((resultJson as { constitutionWarnings?: unknown }).constitutionWarnings)
  ) {
    return [];
  }

  return (resultJson as { constitutionWarnings: unknown[] }).constitutionWarnings.filter(
    isConstitutionWarning,
  );
}

export function parseConstitutionCheck(planContent: string): ConstitutionWarning[] {
  const warnings: ConstitutionWarning[] = [];
  const lines = planContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      continue;
    }
    if (trimmed.includes('---')) {
      continue;
    }

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length < 3) {
      continue;
    }

    const clause = cells[0] ?? '';
    const statusRaw = cells[1] ?? '';
    const note = cells[2] ?? '';
    if (!clause || clause === '宪法条目') {
      continue;
    }

    let status: ConstitutionWarning['status'] | null = null;
    if (statusRaw.includes('❌')) {
      status = 'conflict';
    } else if (statusRaw.includes('⚠️')) {
      status = 'warning';
    } else if (statusRaw.includes('✅')) {
      status = 'pass';
    }

    if (!status) {
      continue;
    }

    warnings.push({ clause, status, note });
  }

  return warnings;
}
