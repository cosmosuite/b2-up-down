import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Modal from 'react-modal';
import './App.css';

const API_BASE_URL = process.env.REACT_APP_API_URL;

// Helper function to get filename from URL
function getFileNameFromUrl(url) {
  try {
    const urlParts = url.split('/');
    return urlParts[urlParts.length - 1].split('?')[0] || 'file';
  } catch (error) {
    return 'file';
  }
}

Modal.setAppElement('#root');

function App() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadUrl, setUploadUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [contextMenu, setContextMenu] = useState({
    show: false,
    x: 0,
    y: 0,
    type: null, // 'file' or 'folder'
    item: null
  });

  useEffect(() => {
    fetchFolders();
  }, [currentPath]);

  // Add click handler to hide context menu when clicking outside
  useEffect(() => {
    const handleClick = () => setContextMenu({ ...contextMenu, show: false });
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const fetchFolders = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/b2/folders`, {
        params: { path: currentPath }
      });
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

  const handleUploadFile = async () => {
    if (uploadUrl.trim()) {
      try {
        // Convert display name to URL-safe filename
        const fileName = displayName.trim()
          ? displayName.trim()
              .toLowerCase()
              .replace(/[^a-z0-9.]/g, '-') // Replace any non-alphanumeric chars (except dots) with hyphens
              .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
          : getFileNameFromUrl(uploadUrl);

        const response = await axios.post(`${API_BASE_URL}/download`, {
          fileUrl: uploadUrl,
          folder: currentPath,
          fileName: fileName,
          displayName: displayName.trim() || fileName
        });

        console.log(response.data.message);
        setUploadUrl('');
        setDisplayName('');
        alert('File uploaded successfully!');
        fetchFolders();
      } catch (error) {
        console.error('Failed to upload file:', error);
        alert('Failed to upload file. Please try again.');
      }
    }
  };

  const handleCreateFolder = async () => {
    if (newFolderName.trim()) {
      try {
        // Construct the full path if we're in a subfolder
        const fullPath = currentPath 
          ? `${currentPath}/${newFolderName}`
          : newFolderName;

        const response = await axios.post(`${API_BASE_URL}/b2/create-folder`, {
          folderName: fullPath
        });

        console.log(response.data.message);
        setNewFolderName('');
        setIsNewFolderModalOpen(false);
        fetchFolders(); // Refresh the folder list
        alert('Folder created successfully!');
      } catch (error) {
        console.error('Failed to create folder:', error);
        alert('Failed to create folder. Please try again.');
      }
    }
  };

  const handleDeleteFile = async (file) => {
    if (window.confirm(`Are you sure you want to delete "${file.name}"?`)) {
      try {
        // Construct the full file path
        const fullPath = currentPath 
          ? `${currentPath}/${file.name}`
          : file.name;

        console.log('Deleting file:', { fileId: file.fileId, fileName: fullPath });
        
        await axios.delete(`${API_BASE_URL}/b2/file/${file.fileId}`, {
          params: { fileName: fullPath }
        });
        
        fetchFolders();
        alert('File deleted successfully');
      } catch (error) {
        console.error('Failed to delete file:', error);
        alert('Failed to delete file. Please try again.');
      }
    }
  };

  const handleDeleteFolder = async (folder) => {
    if (window.confirm(`Are you sure you want to delete folder "${folder}" and all its contents?`)) {
      try {
        const folderPath = currentPath 
          ? `${currentPath}/${folder}`
          : folder;
        
        await axios.delete(`${API_BASE_URL}/b2/folder/${folderPath}`);
        fetchFolders(); // Refresh the list
        alert('Folder deleted successfully');
      } catch (error) {
        console.error('Failed to delete folder:', error);
        alert('Failed to delete folder. Please try again.');
      }
    }
  };

  const handleContextMenu = (e, type, item) => {
    e.preventDefault();
    setContextMenu({
      show: true,
      x: e.pageX,
      y: e.pageY,
      type,
      item
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>My Drive</h1>
        <div className="header-buttons">
          <button onClick={() => setIsNewFolderModalOpen(true)} className="new-folder-button">
            New Folder
          </button>
          <button onClick={() => setIsUploadModalOpen(true)} className="upload-button">
            Upload File
          </button>
        </div>
      </header>
      <div className="breadcrumb">
        <span onClick={() => setCurrentPath('')}>root</span>
        {currentPath.split('/').filter(Boolean).map((folder, index) => (
          <span key={index} onClick={() => handleBreadcrumbClick(index)}>
            {' / '}{folder}
          </span>
        ))}
      </div>
      <div className="content-container">
        {loading ? (
          <div className="loading">Loading...</div>
        ) : error ? (
          <div className="error" onClick={fetchFolders}>
            {error} (Click to retry)
          </div>
        ) : (
          <>
            {folders.length === 0 && files.length === 0 ? (
              <div className="empty">This folder is empty</div>
            ) : (
              <>
                {folders.map(folder => (
                  <div 
                    key={folder} 
                    className="item folder"
                    onClick={() => handleSelect(folder)}
                    onContextMenu={(e) => handleContextMenu(e, 'folder', folder)}
                  >
                    <div className="item-content">
                      <span className="icon">📁</span>
                      <span className="name">{folder}</span>
                    </div>
                  </div>
                ))}
                
                {files.map(file => (
                  <div 
                    key={file.fileId} 
                    className="item file"
                    onContextMenu={(e) => handleContextMenu(e, 'file', file)}
                  >
                    <div className="item-content">
                      <span className="icon">📄</span>
                      <span className="name">
                        {file.displayName || file.name}
                      </span>
                      <span className="size">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.show && (
        <div 
          className="context-menu"
          style={{ 
            top: contextMenu.y,
            left: contextMenu.x 
          }}
        >
          {contextMenu.type === 'folder' && (
            <button 
              onClick={() => {
                handleDeleteFolder(contextMenu.item);
                setContextMenu({ ...contextMenu, show: false });
              }}
            >
              Delete Folder
            </button>
          )}
          {contextMenu.type === 'file' && (
            <button 
              onClick={() => {
                handleDeleteFile(contextMenu.item);
                setContextMenu({ ...contextMenu, show: false });
              }}
            >
              Delete File
            </button>
          )}
        </div>
      )}

      <Modal
        isOpen={isUploadModalOpen}
        onRequestClose={() => setIsUploadModalOpen(false)}
        contentLabel="Upload File"
        className="upload-modal"
        overlayClassName="upload-modal-overlay"
      >
        <h2>Upload File to {currentPath || 'root'}</h2>
        <div className="upload-form">
          <div className="form-group">
            <label>File URL:</label>
            <input
              type="text"
              value={uploadUrl}
              onChange={(e) => setUploadUrl(e.target.value)}
              placeholder="Enter file URL"
            />
          </div>
          <div className="form-group">
            <label>Display Name:</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter file name"
            />
            <small>Spaces and special characters will be converted to hyphens</small>
          </div>
          <div className="button-group">
            <button onClick={handleUploadFile}>Upload</button>
            <button onClick={() => setIsUploadModalOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isNewFolderModalOpen}
        onRequestClose={() => setIsNewFolderModalOpen(false)}
        contentLabel="Create New Folder"
        className="folder-modal"
        overlayClassName="folder-modal-overlay"
      >
        <h2>Create New Folder in {currentPath || 'root'}</h2>
        <div className="folder-form">
          <div className="form-group">
            <label>Folder Name:</label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter folder name"
            />
            <small>Spaces and special characters will be converted to hyphens</small>
          </div>
          <div className="button-group">
            <button onClick={handleCreateFolder}>Create</button>
            <button onClick={() => {
              setIsNewFolderModalOpen(false);
              setNewFolderName('');
            }}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default App; 