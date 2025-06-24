'use client';

import { useState, useEffect } from 'react';
import PDFViewer from '@/components/PDFViewer';
import PDFUpload from '@/components/PDFUpload';
import { Annotation } from '@/types/annotation';

export default function Home() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    // Load PDF from URL parameter
    const pdfParam = params.get('pdf');
    if (pdfParam) {
      const basePath = window.location.pathname.includes('/douroannotate') ? '/douroannotate' : '';
      setPdfUrl(`${basePath}/${pdfParam}`);
    }
    
    // Load annotations from URL parameter
    const annotationsParam = params.get('annotations');
    if (annotationsParam) {
      try {
        const parsedAnnotations = JSON.parse(decodeURIComponent(annotationsParam));
        setAnnotations(parsedAnnotations);
      } catch (e) {
        console.error('Failed to parse annotations from URL', e);
      }
    }
  }, []);

  const handleFileUpload = (file: File) => {
    setPdfFile(file);
  };

  const handleAnnotationsChange = (newAnnotations: Annotation[]) => {
    setAnnotations(newAnnotations);
    const params = new URLSearchParams(window.location.search);
    params.set('annotations', encodeURIComponent(JSON.stringify(newAnnotations)));
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto p-4">
        <h1 className="text-3xl font-bold text-center mb-8">PDF Annotator</h1>
        
        {!pdfFile && !pdfUrl ? (
          <PDFUpload onFileUpload={handleFileUpload} />
        ) : (
          <PDFViewer 
            file={pdfFile}
            url={pdfUrl} 
            annotations={annotations}
            onAnnotationsChange={handleAnnotationsChange}
            onReset={() => {
              setPdfFile(null);
              setPdfUrl(null);
              setAnnotations([]);
              window.history.replaceState({}, '', window.location.pathname);
            }}
          />
        )}
      </div>
    </main>
  );
}
