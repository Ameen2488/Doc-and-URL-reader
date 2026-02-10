// Access global ePub object from script tag
declare const ePub: any;

export async function loadEpubDocument(file: File): Promise<any> {
    const arrayBuffer = await file.arrayBuffer();
    // Initialize book
    const book = ePub(arrayBuffer);
    await book.ready;
    return book;
}

export async function extractEpubChapters(book: any): Promise<any[]> {
    const { toc } = book.navigation;
    const chapters: any[] = [];
    
    // Flatten the TOC structure
    const processItems = (items: any[]) => {
        items.forEach(item => {
            // Only add if it has a valid href
            if (item.href) {
                chapters.push({
                    id: item.id || Math.random().toString(36),
                    title: item.label ? item.label.trim() : "Untitled Section",
                    href: item.href,
                    startPage: 0, // Not applicable for EPUB
                    endPage: 0
                });
            }
            if (item.subitems && item.subitems.length > 0) {
                processItems(item.subitems);
            }
        });
    };
    
    processItems(toc);
    
    // If TOC is empty, fall back to spine
    if (chapters.length === 0) {
        book.spine.each((section: any) => {
            chapters.push({
                 id: section.idRef || Math.random().toString(36),
                 title: `Section ${section.index + 1}`,
                 href: section.href,
                 startPage: 0,
                 endPage: 0
            });
        });
    }

    return chapters;
}

export async function getEpubChapterContent(book: any, chapter: any): Promise<string> {
    if (!chapter.href) return "";

    try {
        // Resolve the section from the href
        // Sometimes href has anchor #, remove it for section lookup usually, 
        // but load() handles it.
        const section = book.spine.get(chapter.href);
        if (!section) return "";

        // Load the content document (DOM)
        // We bind book.load because section.load calls it
        const doc = await section.load(book.load.bind(book));
        
        if (!doc) return "";

        // Process images to ensure they display
        // epub.js resources are inside the zip. We need to convert them to Blob URLs.
        const images = doc.querySelectorAll('img');
        const promises: Promise<void>[] = [];

        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const src = img.getAttribute('src');
            if (src && !src.startsWith('http') && !src.startsWith('data:')) {
                const p = (async () => {
                    try {
                        // Resolve absolute path in the archive
                        const absolutePath = book.path.resolve(src, section.href);
                        // Get Blob URL
                        const url = await book.archive.createUrl(absolutePath);
                        if (url) {
                            img.setAttribute('src', url);
                            // Also set max-width for better display in reader
                            img.style.maxWidth = '100%';
                            img.style.height = 'auto';
                        }
                    } catch (e) {
                        console.warn("Could not resolve epub image:", src, e);
                    }
                })();
                promises.push(p);
            }
        }

        await Promise.all(promises);

        // Serialize back to HTML string
        // If doc is a Document, use documentElement.outerHTML or body.innerHTML
        // Usually body innerHTML is what we want for the reader content
        return doc.body.innerHTML;

    } catch (e) {
        console.error("Error loading epub chapter:", e);
        return "<p>Error loading content.</p>";
    }
}