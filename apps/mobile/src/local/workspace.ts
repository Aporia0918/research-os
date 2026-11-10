/** Reserved for local background work, never a blocking network operation. */
export interface Summary { title: string; rows: { id: string; text: string }[] }
export const research = { mode: 'on-device' as const };
