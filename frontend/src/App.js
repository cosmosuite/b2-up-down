import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE_URL = process.env.REACT_APP_API_URL;

function App() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchFolders();
  }, [currentPath]);

  const fetchFolders = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/b2/folders`, {
        params: { path: currentPath }
      });
      console.log('API Response:', response.data);
      setFolders(response.data.folders);
      setFiles(response.data.files);
      setError(null);
    } catch (error) {
      console.error('Folder fetch error:', error);
      setError('Failed to fetch folders. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (folder) => {
    const newPath = folder === 'root' ? '' : `${currentPath}/${folder}`;
    setCurrentPath(newPath);
  };

  const handleBreadcrumbClick = (index) => {
    const newPath = currentPath.split('/').slice(0, index + 1).join('/');
    setCurrentPath(newPath);
  };

  const getFriendlyUrl = (fullPath) => {
    if (!fullPath) {
      console.error('Full path is undefined');
      return '#';
    }
    const encodedPath = encodeURIComponent(fullPath).replace(/%20/g, '+');
    const url = `https://f005.backblazeb2.com/file/${process.env.REACT_APP_B2_BUCKET_NAME}/${encodedPath}`;
    console.log('Generated URL:', url);
    return url;
  };

  const downloadCSV = () => {
    const csvRows = [
      ['Type', 'Name', 'Friendly URL'],
      ...files.map(file => [
        'File',
        file.displayName || file.name,
        getFriendlyUrl(file.fullPath)
      ])
    ];

    const csvContent = csvRows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'files.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>My Drive</h1>
      </header>
      <div className="breadcrumb">
        <span onClick={() => setCurrentPath('')}>root</span>
        {currentPath.split('/').filter(Boolean).map((folder, index) => (
          <span key={index} onClick={() => handleBreadcrumbClick(index)}>
            {' / '}{folder}
          </span>
        ))}
      </div>
      {currentPath !== '' && (
        <button onClick={() => setCurrentPath('')} className="back-to-root-button">
          Back to Root
        </button>
      )}
      <div className="content-container">
        {loading ? (
          <div className="loading">Loading...</div>
        ) : error ? (
          <div className="error" onClick={fetchFolders}>
            {error} (Click to retry)
          </div>
        ) : (
          <>
            {currentPath === '' ? (
              <div className="folder-container">
                {folders.map(folder => (
                  <div 
                    key={folder} 
                    className="folder-item"
                    onClick={() => handleSelect(folder)}
                  >
                    📁 {folder}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <button onClick={downloadCSV} className="download-csv-button">
                  Download CSV
                </button>
                <table className="file-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Name</th>
                      <th>Friendly URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folders.map(folder => (
                      <tr key={folder}>
                        <td>Folder</td>
                        <td onClick={() => handleSelect(folder)} style={{ cursor: 'pointer' }}>
                          {folder}
                        </td>
                        <td>-</td>
                      </tr>
                    ))}
                    {files.map(file => (
                      <tr key={file.fileId}>
                        <td>File</td>
                        <td>{file.displayName || file.name}</td>
                        <td>
                          <a href={getFriendlyUrl(file.fullPath)} target="_blank" rel="noopener noreferrer">
                            {getFriendlyUrl(file.fullPath)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App; 