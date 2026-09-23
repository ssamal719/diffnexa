/** A request, from outside a report, to show one change. A new token means "again". */
export type FocusRequest = { id: string; token: number } | null;
