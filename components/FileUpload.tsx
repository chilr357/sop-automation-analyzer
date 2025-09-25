import React, { useState, useRef } from 'react';
import { UploadIcon, DocumentIcon, XIcon } from './IconComponents';

interface FileUploadProps {
  onAnalyze: (files: File[]) => void;
  isLoading: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onAnalyze, isLoading }) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setSelectedFiles(Array.from(event.target.files));
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
      if (droppedFiles.length > 0) {
        setSelectedFiles(droppedFiles);
      } else {
        alert("Please drop PDF files.");
      }
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleAnalyzeClick = () => {
    if (selectedFiles.length > 0) {
      onAnalyze(selectedFiles);
    }
  };

  const handleRemoveFile = (indexToRemove: number) => {
    setSelectedFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-brand-light border border-brand-border rounded-lg shadow-lg">
      <div 
        className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-md transition-colors duration-300 cursor-pointer ${isDragging ? 'border-brand-blue bg-blue-900/20' : 'border-brand-border hover:border-brand-blue'}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={triggerFileSelect}
      >
        <UploadIcon className="w-12 h-12 text-brand-gray" />
        <p className="mt-4 text-center text-brand-gray">
          <span className="font-semibold text-brand-blue">Click to upload</span> or drag and drop
        </p>
        <p className="text-xs text-brand-gray mt-1">SOP Documents (PDF only)</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={handleFileChange}
          multiple
        />
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold text-brand-gray">Selected Files:</h3>
          <ul className="max-h-40 overflow-y-auto space-y-2 rounded-md border border-brand-border p-2 bg-gray-800/50">
            {selectedFiles.map((file, index) => (
              <li key={index} className="flex items-center justify-between bg-brand-dark p-2 rounded">
                <div className="flex items-center space-x-2 truncate">
                  <DocumentIcon className="w-5 h-5 text-brand-blue flex-shrink-0" />
                  <span className="text-sm truncate" title={file.name}>{file.name}</span>
                </div>
                <button onClick={() => handleRemoveFile(index)} className="p-1 rounded-full hover:bg-gray-700 transition-colors">
                  <XIcon className="w-4 h-4 text-brand-gray" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={handleAnalyzeClick}
        disabled={selectedFiles.length === 0 || isLoading}
        className="mt-6 w-full bg-brand-blue text-white font-bold py-3 px-4 rounded-md hover:bg-blue-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center"
      >
        {isLoading ? 'Analyzing...' : `Analyze ${selectedFiles.length} Document(s)`}
      </button>
    </div>
  );
};