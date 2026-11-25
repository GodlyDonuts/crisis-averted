export const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.NODE_ENV === "production" ? "/crisis-averted" : "");

export function assetPath(path: string): string {
  return `${PUBLIC_BASE_PATH}${path}`;
}
