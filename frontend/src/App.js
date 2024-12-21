import React, { useState } from 'react';
import FolderSelector from './components/FolderSelector';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [status, setStatus] = useState('');
  const [b2Url, setB2Url] = useState('');

  const handleDownload = async (e) => {
    e.preventDefault();
    setStatus('Processing...');
    setB2Url('');

    try {
      if (!url.trim()) {
        setStatus('Please enter a valid URL');
        return;
      }

      const response = await fetch('http://localhost:5005/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          fileUrl: url,
          folder: selectedFolder
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setStatus(`File processed successfully!`);
        setB2Url(data.b2Url);
      } else {
        setStatus(`Error: ${data.error}${data.details ? ` - ${data.details}` : ''}`);
      }
    } catch (error) {
      console.error('Error:', error);
      setStatus(`Network error: ${error.message}`);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>File Downloader</h1>
        <form onSubmit={handleDownload}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter file URL"
            required
            className="url-input"
          />
          <FolderSelector
            selectedFolder={selectedFolder}
            onSelect={setSelectedFolder}
          />
          <button type="submit">Process File</button>
        </form>
        {status && <p className="status">{status}</p>}
        {b2Url && (
          <div className="result">
            <p>File uploaded to B2:</p>
            <a href={b2Url} target="_blank" rel="noopener noreferrer" className="b2-link">
              {b2Url}
            </a>
          </div>
        )}
      </header>
    </div>
  );
}

export default App; 