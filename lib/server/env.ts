type EnvValue = string | undefined;

function readEnv(name: string): EnvValue {
  return process.env[name];
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

