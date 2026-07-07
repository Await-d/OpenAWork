import { z } from 'zod';

export async function readBridgeErrorMessage(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    const parsed = z.object({ error: z.string().optional() }).safeParse(data);
    if (parsed.success && parsed.data.error) {
      return parsed.data.error;
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  return null;
}
