type EnvValue = string | undefined;

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }

  return trimmed;
}

function readEnv(name: string): EnvValue {
  return normalizeEnvValue(process.env[name]);
}

export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = readEnv(name);
  return value ? value : undefined;
}

export function envNumber(name: string, fallback?: number): number {
  const raw = readEnv(name);
  if (!raw) {
    if (fallback === undefined) throw new Error(`Missing environment variable: ${name}`);
    return fallback;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) throw new Error(`Invalid number for environment variable: ${name}`);
  return num;
}
