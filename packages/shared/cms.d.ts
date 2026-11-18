export type FieldKind = 'text' | 'textarea' | 'markdown' | 'url' | 'image' | 'video' | 'number' | 'select' | 'list';
export type Field = { name: string; label: string; kind: FieldKind; required?: boolean; max?: number; min?: number; options?: string[]; fields?: Field[] };
export type Block = { id: string; type: string; [field: string]: unknown };
export declare const PAGE_KINDS: string[];
export declare const PAGE_KIND_LABEL: Record<string, string>;
export declare const BLOCK_TYPES: Record<string, { label: string; fields: Field[] }>;
export declare function validateBlocks(blocks: unknown): string | null;
