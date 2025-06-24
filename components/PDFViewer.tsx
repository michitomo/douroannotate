'use client';

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import Draggable from 'react-draggable';
import { Annotation } from '@/types/annotation';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Use dynamic worker path that respects basePath
if (typeof window !== 'undefined') {
  const basePath = window.location.pathname.includes('/douroannotate') ? '/douroannotate' : '';
  pdfjs.GlobalWorkerOptions.workerSrc = `${basePath}/pdf.worker.min.mjs`;
} else {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

interface PDFViewerProps {
  file?: File | null;
  url?: string | null;
  annotations: Annotation[];
  onAnnotationsChange: (annotations: Annotation[]) => void;
  onReset: () => void;
}

const PDFViewer: React.FC<PDFViewerProps> = ({ file, url, annotations, onAnnotationsChange, onReset }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [newText, setNewText] = useState<string>('');
  const [fontSize, setFontSize] = useState<number>(16);
  const [textColor, setTextColor] = useState<string>('#000000');
  const [pdfDimensions, setPdfDimensions] = useState<{ [key: number]: { width: number; height: number } }>({});
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const onPageLoadSuccess = ({ width, height }: { width: number; height: number }) => {
    setPdfDimensions(prev => ({
      ...prev,
      [pageNumber]: { width, height }
    }));
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = pageRef.current?.getBoundingClientRect();
    if (rect) {
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      
      // Add placeholder text directly
      const newAnnotation: Annotation = {
        id: Date.now().toString(),
        text: 'テキスト',
        x,
        y,
        fontSize,
        color: textColor,
        pageNumber,
      };

      onAnnotationsChange([...annotations, newAnnotation]);
      // Immediately start editing the new annotation
      setTimeout(() => {
        setSelectedAnnotation(newAnnotation.id);
        setEditingText(newAnnotation.text);
      }, 50);
    }
  };

  const addAnnotation = () => {
    const newAnnotation: Annotation = {
      id: Date.now().toString(),
      text: newText.trim() || 'テキスト',
      x: 100,
      y: 100,
      fontSize,
      color: textColor,
      pageNumber,
    };

    onAnnotationsChange([...annotations, newAnnotation]);
    setNewText('');
  };

  const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
    onAnnotationsChange(
      annotations.map((ann) => (ann.id === id ? { ...ann, ...updates } : ann))
    );
  };

  const deleteAnnotation = (id: string) => {
    onAnnotationsChange(annotations.filter((ann) => ann.id !== id));
    setSelectedAnnotation(null);
  };

  const startEditing = (annotation: Annotation) => {
    setSelectedAnnotation(annotation.id);
    setEditingText(annotation.text);
  };

  const saveEdit = () => {
    if (selectedAnnotation && editingText.trim()) {
      updateAnnotation(selectedAnnotation, { text: editingText });
    }
    setSelectedAnnotation(null);
    setEditingText('');
  };

  const exportPDF = async () => {
    try {
      let existingPdfBytes;
      if (file) {
        existingPdfBytes = await file.arrayBuffer();
      } else if (url) {
        const response = await fetch(url);
        existingPdfBytes = await response.arrayBuffer();
      } else {
        throw new Error('No PDF loaded');
      }
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      
      let font;
      try {
        // Try to use custom font for Unicode support
        pdfDoc.registerFontkit(fontkit);
        const fontUrl = 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-jp@5.0.0/files/noto-serif-jp-japanese-400-normal.woff';
        const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
        font = await pdfDoc.embedFont(fontBytes);
        console.log('Using custom Mincho font');
      } catch (fontError) {
        // Fallback to standard font
        console.error('Failed to load custom font, using standard font:', fontError);
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      }

      // Group annotations by page
      const annotationsByPage = annotations.reduce((acc, ann) => {
        if (!acc[ann.pageNumber]) acc[ann.pageNumber] = [];
        acc[ann.pageNumber].push(ann);
        return acc;
      }, {} as Record<number, Annotation[]>);

      const pages = pdfDoc.getPages();
      
      for (const [pageNum, pageAnnotations] of Object.entries(annotationsByPage)) {
        const page = pages[parseInt(pageNum) - 1];
        if (!page) continue;

        const { width, height } = page.getSize();
        const pageNumInt = parseInt(pageNum);
        const pageDims = pdfDimensions[pageNumInt] || { width, height };
        
        for (const annotation of pageAnnotations) {
          const hexColor = annotation.color.substring(1);
          const r = parseInt(hexColor.substring(0, 2), 16) / 255;
          const g = parseInt(hexColor.substring(2, 4), 16) / 255;
          const b = parseInt(hexColor.substring(4, 6), 16) / 255;

          // Calculate actual position based on PDF dimensions
          // Note: PDF coordinate system has origin at bottom-left, while browser has it at top-left
          // Ensure we're working with positive coordinates
          const normalizedX = Math.max(0, annotation.x);
          const normalizedY = Math.max(0, annotation.y);
          
          const pdfX = (normalizedX / pageDims.width) * width;
          const pdfY = height - ((normalizedY + annotation.fontSize) / pageDims.height) * height;

          try {
            page.drawText(annotation.text, {
              x: Math.max(0, pdfX),
              y: Math.max(0, pdfY),
              size: annotation.fontSize,
              font: font,
              color: rgb(r, g, b),
            });
          } catch (drawError) {
            console.error('Error drawing text:', drawError);
          }
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `annotated_${file?.name || 'document.pdf'}`;
      a.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF. Please try again.');
    }
  };

  const pageAnnotations = annotations.filter((ann) => ann.pageNumber === pageNumber);
  
  const nodeRefs = useMemo(() => {
    const refs: { [key: string]: React.RefObject<HTMLDivElement | null> } = {};
    pageAnnotations.forEach(ann => {
      refs[ann.id] = React.createRef<HTMLDivElement>();
    });
    return refs;
  }, [pageAnnotations]);


  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex flex-wrap gap-4 items-end mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">テキスト</label>
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="追加するテキスト"
              className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ fontFamily: '"Noto Serif JP", serif' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">フォントサイズ</label>
            <input
              type="number"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              min="8"
              max="72"
              className="px-3 py-2 border rounded w-20 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">色</label>
            <input
              type="color"
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              className="h-10 w-20 border rounded cursor-pointer"
            />
          </div>
          <button
            onClick={addAnnotation}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            テキスト追加
          </button>
        </div>

        <div className="flex gap-4 items-center">
          <button
            onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
            disabled={pageNumber <= 1}
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            前へ
          </button>
          <span>
            ページ {pageNumber} / {numPages}
          </span>
          <button
            onClick={() => setPageNumber(Math.min(numPages, pageNumber + 1))}
            disabled={pageNumber >= numPages}
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            次へ
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setScale(scale - 0.1)}
              className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
            >
              縮小
            </button>
            <span className="px-2">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale(scale + 0.1)}
              className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
            >
              拡大
            </button>
            <button
              onClick={exportPDF}
              className="px-4 py-1 bg-green-500 text-white rounded hover:bg-green-600"
            >
              PDFエクスポート
            </button>
            <button
              onClick={onReset}
              className="px-4 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            >
              新規PDF
            </button>
          </div>
        </div>
      </div>

      <div className="relative bg-gray-200 p-4 rounded-lg overflow-auto" ref={containerRef}>
        <div 
          className="relative inline-block" 
          ref={pageRef} 
          style={{ position: 'relative' }}
          onContextMenu={handleContextMenu}
        >
          <Document file={file || url} onLoadSuccess={onDocumentLoadSuccess}>
            <Page
              pageNumber={pageNumber}
              scale={scale}
              onLoadSuccess={onPageLoadSuccess}
              className="shadow-lg"
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>

          <div className="absolute inset-0" style={{ zIndex: 10 }}>
            {pageAnnotations.map((annotation) => {
              const isSelected = selectedAnnotation === annotation.id;
              return (
                <Draggable
                  key={annotation.id}
                  position={{ x: annotation.x * scale, y: annotation.y * scale }}
                  onStop={(e, data) => {
                    updateAnnotation(annotation.id, { 
                      x: Math.max(0, data.x / scale), 
                      y: Math.max(0, data.y / scale) 
                    });
                  }}
                  nodeRef={nodeRefs[annotation.id] as React.RefObject<HTMLElement>}
                  scale={scale}
                  disabled={isSelected}
                >
                  <div
                    ref={nodeRefs[annotation.id]}
                    className={`absolute cursor-move select-none group ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
                    style={{
                      fontSize: `${annotation.fontSize * scale}px`,
                      color: annotation.color,
                      fontFamily: '"Noto Serif JP", serif',
                      padding: '2px',
                    }}
                  >
                    {isSelected ? (
                      <div className="relative">
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onBlur={saveEdit}
                          onKeyPress={(e) => e.key === 'Enter' && saveEdit()}
                          className="bg-white px-1 border border-blue-500 rounded"
                          style={{ 
                            fontSize: `${annotation.fontSize * scale}px`,
                            color: annotation.color,
                            fontFamily: '"Noto Serif JP", serif',
                            minWidth: '100px'
                          }}
                          autoFocus
                        />
                        <div className="absolute -top-10 left-0 flex gap-2 bg-white rounded shadow p-2">
                          <input
                            type="number"
                            value={annotation.fontSize}
                            onChange={(e) => updateAnnotation(annotation.id, { fontSize: Number(e.target.value) })}
                            min="8"
                            max="72"
                            className="w-16 px-2 py-1 border rounded text-sm"
                            placeholder="サイズ"
                          />
                          <input
                            type="color"
                            value={annotation.color}
                            onChange={(e) => updateAnnotation(annotation.id, { color: e.target.value })}
                            className="w-8 h-8 border rounded cursor-pointer"
                          />
                          <button
                            onClick={() => deleteAnnotation(annotation.id)}
                            className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span 
                          className="whitespace-nowrap hover:bg-yellow-100 hover:bg-opacity-50 px-1 rounded"
                          onDoubleClick={() => startEditing(annotation)}
                        >
                          {annotation.text}
                        </span>
                        <div className="absolute -top-8 left-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded shadow p-1">
                          <button
                            onClick={() => startEditing(annotation)}
                            className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => deleteAnnotation(annotation.id)}
                            className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                          >
                            削除
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </Draggable>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
};

export default PDFViewer;