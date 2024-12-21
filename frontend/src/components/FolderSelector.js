import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Modal from 'react-modal';
import './FolderSelector.css';

const API_BASE_URL = 'http://localhost:5005';

Modal.setAppElement('#root'); // Set the app element for accessibility

function FolderSelector({ onSelect, selectedFolder }) {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    fetchFolders();
  }, []);

  const fetchFolders = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/b2/folders`);
      setFolders(['root', ...response.data.folders]);
      setError(null);
    } catch (error) {
      console.error('Folder fetch error:', error);
      setError('Failed to fetch folders. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (folder) => {
    onSelect(folder === 'root' ? '' : folder);
    setIsModalOpen(false);
  };

  const handleCreateFolder = async () => {
    if (newFolderName.trim() && !folders.includes(newFolderName)) {
      try {
        const response = await axios.post(`${API_BASE_URL}/b2/create-folder`, {
          folderName: newFolderName
        });
        console.log(response.data.message);
        setFolders([...folders, newFolderName]);
        setNewFolderName('');
      } catch (error) {
        console.error('Failed to create folder:', error);
        alert('Failed to create folder. Please try again.');
      }
    }
  };

  return (
    <div className="folder-selector">
      <button 
        type="button"
        className="folder-selector-trigger"
        onClick={() => setIsModalOpen(true)}
      >
        <span>{selectedFolder || 'Select Folder'}</span>
        <span className="folder-icon">📁</span>
      </button>

      <Modal
        isOpen={isModalOpen}
        onRequestClose={() => setIsModalOpen(false)}
        contentLabel="Select Folder"
        className="folder-modal"
        overlayClassName="folder-modal-overlay"
      >
        <h2>Select a Folder</h2>
        {loading ? (
          <div className="folder-item loading">Loading folders...</div>
        ) : error ? (
          <div className="folder-item error" onClick={fetchFolders}>
            {error} (Click to retry)
          </div>
        ) : folders.length === 0 ? (
          <div className="folder-item">No folders found</div>
        ) : (
          folders.map(folder => (
            <div
              key={folder}
              className={`folder-item ${selectedFolder === folder ? 'selected' : ''}`}
              onClick={() => handleSelect(folder)}
            >
              📁 {folder || 'root'}
            </div>
          ))
        )}
        <div className="new-folder">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="New folder name"
          />
          <button onClick={handleCreateFolder}>Create Folder</button>
        </div>
        <button onClick={() => setIsModalOpen(false)}>Close</button>
      </Modal>
    </div>
  );
}

export default FolderSelector; 