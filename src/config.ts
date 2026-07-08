import "dotenv/config";

export type AppConfig = {
  telegram: {
    apiId: number;
    apiHash: string;
    session: string;
  };
};

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function optionalEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function requiredNumberEnv(name: string): number {
  const rawValue = requiredEnv(name);
  const value = Number(rawValue);

  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer.`);
  }

  return value;
}

export function loadConfig(options?: { requireSession?: boolean }): AppConfig {
  const requireSession = options?.requireSession ?? true;

  return {
    telegram: {
      apiId: requiredNumberEnv("TELEGRAM_API_ID"),
      apiHash: requiredEnv("TELEGRAM_API_HASH"),
      session: requireSession ? requiredEnv("TELEGRAM_SESSION") : optionalEnv("TELEGRAM_SESSION"),
    },
  };
}
