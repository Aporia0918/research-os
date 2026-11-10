export type Choice = 'accepted' | 'ignored' | 'edited';
export interface ItemFeedback { choice?: Choice; editedText?: string }
