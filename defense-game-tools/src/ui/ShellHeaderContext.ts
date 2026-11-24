import { createContext } from 'react';

export interface ShellHeaderSlots {
  leftSlot: HTMLDivElement | null;
  rightSlot: HTMLDivElement | null;
}

/**
 * Provides header portal targets inside ToolShell's single 36px top bar so Map Studio
 * injects File/Edit/View and action controls cleanly without adding a second header row.
 */
export const ShellHeaderContext = createContext<ShellHeaderSlots>({
  leftSlot: null,
  rightSlot: null,
});
