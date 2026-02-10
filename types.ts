export interface ReadingSegment {
  id: string;
  type: 'text' | 'visual_description';
  content: string;
  audioBuffer?: AudioBuffer;
  bbox?: number[]; // [ymin, xmin, ymax, xmax] normalized to 1000
  imageUrl?: string; // Base64 for PDF crops, URL for Web images
}

export interface Chapter {
  id: string;
  title: string;
  startPage: number; // For PDF (1-based)
  endPage: number;   // For PDF
  content?: string;  // For URL/HTML mode
}

export interface PdfPageData {
  pageNumber: number;
  imageUrl: string;
}

export enum AppMode {
  READER = 'READER',
  IMAGE_GEN = 'IMAGE_GEN',
}

export interface ImageGenerationConfig {
  prompt: string;
  size: '1K' | '2K' | '4K';
}

// Augment window for PDF.js and AI Studio
declare global {
  // Augment the existing AIStudio interface (or define it if missing but linked by Window)
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    pdfjsLib: any;
  }
}