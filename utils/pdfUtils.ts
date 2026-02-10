export async function loadPdfDocument(file: File): Promise<any> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf;
}

export async function renderPdfPage(pdf: any, pageNumber: number): Promise<string> {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 }); // Good quality for OCR/Analysis
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) throw new Error("Canvas context not available");

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    const base64 = canvas.toDataURL('image/jpeg', 0.8);
    // Remove prefix for Gemini API
    const cleanBase64 = base64.split(',')[1];
    return cleanBase64;
}

// Extract raw text from the entire PDF for structure analysis
export async function extractPdfText(pdf: any): Promise<{ fullText: string; pageMap: string[] }> {
  const numPages = pdf.numPages;
  let fullText = "";
  const pageMap: string[] = []; // index = page number - 1

  // Limit initial extraction to ~50 pages to prevent browser lockup on massive docs
  const limit = Math.min(numPages, 50);

  for (let i = 1; i <= limit; i++) {
    const page = await pdf.getPage(i);
    const tokenizedText = await page.getTextContent();
    const pageText = tokenizedText.items.map((token: any) => token.str).join(' ');
    
    pageMap.push(pageText);
    fullText += `--- PAGE ${i} ---\n${pageText}\n`;
  }

  return { fullText, pageMap };
}

export async function cropImageFromBase64(base64: string, bbox: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("No context"));
        return;
      }

      // bbox is [ymin, xmin, ymax, xmax] on 0-1000 scale
      // Convert to pixels
      const [ymin, xmin, ymax, xmax] = bbox;
      
      const width = img.width;
      const height = img.height;

      const x = (xmin / 1000) * width;
      const y = (ymin / 1000) * height;
      const w = ((xmax - xmin) / 1000) * width;
      const h = ((ymax - ymin) / 1000) * height;

      // Add a small padding (10px) to the crop if possible
      const padding = 10;
      const finalX = Math.max(0, x - padding);
      const finalY = Math.max(0, y - padding);
      const finalW = Math.min(width - finalX, w + padding * 2);
      const finalH = Math.min(height - finalY, h + padding * 2);

      canvas.width = finalW;
      canvas.height = finalH;

      ctx.drawImage(img, finalX, finalY, finalW, finalH, 0, 0, finalW, finalH);
      resolve(canvas.toDataURL('image/jpeg'));
    };
    img.onerror = reject;
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

// Deprecated but kept for compatibility
export async function convertPdfToImages(file: File): Promise<string[]> {
  const pdf = await loadPdfDocument(file);
  const numPages = pdf.numPages;
  const images: string[] = [];
  const pagesToProcess = Math.min(numPages, 5); 

  for (let i = 1; i <= pagesToProcess; i++) {
    const base64 = await renderPdfPage(pdf, i);
    images.push(base64);
  }

  return images;
}