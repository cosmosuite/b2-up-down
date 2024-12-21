import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

console.log('Environment variables loaded:', {
  B2_KEY_ID: process.env.B2_KEY_ID ? 'Set' : 'Not set',
  B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY ? 'Set' : 'Not set',
  B2_BUCKET_ID: process.env.B2_BUCKET_ID ? 'Set' : 'Not set',
  B2_BUCKET_NAME: process.env.B2_BUCKET_NAME ? 'Set' : 'Not set'
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 5005;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
await fsPromises.mkdir(tempDir, { recursive: true });

// Function to get B2 authorization
async function authorizeB2() {
  try {
    const authString = Buffer.from(`${process.env.B2_KEY_ID}:${process.env.B2_APPLICATION_KEY}`).toString('base64');
    const response = await axios({
      method: 'get',
      url: 'https://api.backblazeb2.com/b2api/v3/b2_authorize_account',
      headers: {
        Authorization: `Basic ${authString}`
      }
    });
    console.log('Authorization response:', response.data);
    return response.data;
  } catch (error) {
    console.error('B2 authorization error:', error);
    throw new Error('Failed to authorize with B2');
  }
}

// Function to upload file to B2
async function uploadToB2(filePath, fileName, folder = '', metadata = {}) {
  try {
    const authResponse = await authorizeB2();
    const apiUrl = authResponse.apiInfo.storageApi.apiUrl;

    // Clean the file name
    const cleanFileName = fileName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '-')
      .replace(/-+/g, '-');

    // Clean the folder path
    const cleanFolder = folder 
      ? folder.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9/-]/g, '-').replace(/-+/g, '-')
      : '';

    // Construct the full B2 file name
    const b2FileName = cleanFolder 
      ? `${cleanFolder}/${cleanFileName}`
      : cleanFileName;

    console.log('Uploading to B2 with file name:', b2FileName);

    const uploadUrlResponse = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v3/b2_get_upload_url`,
      headers: {
        Authorization: authResponse.authorizationToken
      },
      data: {
        bucketId: process.env.B2_BUCKET_ID
      }
    });

    const fileBuffer = await fsPromises.readFile(filePath);
    const fileSize = fileBuffer.length;

    const uploadResponse = await axios({
      method: 'post',
      url: uploadUrlResponse.data.uploadUrl,
      headers: {
        Authorization: uploadUrlResponse.data.authorizationToken,
        'Content-Type': 'b2/x-auto',
        'Content-Length': fileSize,
        'X-Bz-File-Name': encodeURIComponent(b2FileName),
        'X-Bz-Content-Sha1': 'do_not_verify'
      },
      data: fileBuffer,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    return {
      fileId: uploadResponse.data.fileId,
      fileName: uploadResponse.data.fileName,
      name: metadata.displayName || fileName,
      fileUrl: `https://f005.backblazeb2.com/file/${process.env.B2_BUCKET_NAME}/${uploadResponse.data.fileName}`
    };
  } catch (error) {
    console.error('B2 upload error:', error.response?.data || error.message);
    throw new Error(`Failed to upload to B2: ${error.response?.data?.message || error.message}`);
  }
}

// Update the listB2Folders function
async function listB2Folders() {
  try {
    // Get B2 authorization
    const authResponse = await authorizeB2();
    
    // List files to get folders
    const response = await axios({
      method: 'post',
      url: `${authResponse.apiUrl}/b2api/v3/b2_list_file_names`,
      headers: {
        Authorization: authResponse.authorizationToken
      },
      data: {
        bucketId: process.env.B2_BUCKET_ID,
        delimiter: '/',
        prefix: ''
      }
    });

    // Extract unique folders from file paths
    const folders = new Set();
    response.data.files.forEach(file => {
      const path = file.fileName;
      const folderPath = path.split('/').slice(0, -1).join('/');
      if (folderPath) folders.add(folderPath);
    });

    // Also check for folders in common prefixes
    if (response.data.commonPrefixes) {
      response.data.commonPrefixes.forEach(prefix => {
        folders.add(prefix.replace(/\/$/, '')); // Remove trailing slash
      });
    }

    return Array.from(folders).sort();
  } catch (error) {
    console.error('B2 folder list error:', error);
    throw new Error(`Failed to list B2 folders: ${error.message}`);
  }
}

app.post('/download', async (req, res) => {
  try {
    const { fileUrl, folder, fileName, displayName } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({ error: 'File URL is required' });
    }

    console.log('Attempting to download:', fileUrl);
    console.log('Target folder:', folder || 'root');
    
    const defaultFileName = path.basename(fileUrl);
    const finalFileName = fileName || defaultFileName;
    const tempFilePath = path.join(tempDir, finalFileName);

    console.log('Saving to:', tempFilePath);

    try {
      const response = await axios({
        method: 'get',
        url: fileUrl,
        responseType: 'stream',
        timeout: 10000,
        validateStatus: false
      });

      if (response.status !== 200) {
        throw new Error(`Failed to download file. Status: ${response.status}`);
      }

      const writer = response.data.pipe(fs.createWriteStream(tempFilePath));
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', (err) => {
          console.error('Write stream error:', err);
          reject(err);
        });
      });

      console.log('File downloaded successfully, uploading to B2...');

      // Add metadata if display name is provided
      const metadata = {};
      if (displayName) {
        metadata.displayName = displayName;
      }

      // Upload to B2 with folder path and metadata
      const b2Response = await uploadToB2(tempFilePath, finalFileName, folder, metadata);

      // Clean up temp file
      await fsPromises.unlink(tempFilePath);

      res.json({ 
        message: 'File processed successfully',
        fileName: finalFileName,
        b2FileId: b2Response.fileId,
        b2Url: b2Response.fileUrl
      });
    } catch (downloadError) {
      console.error('Download error:', downloadError.message);
      res.status(500).json({ 
        error: 'Failed to process file',
        details: downloadError.message 
      });
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  }
});

// Make sure this endpoint is defined
app.get('/folders', async (req, res) => {
  try {
    const folders = await listB2Folders();
    res.json({ folders });
  } catch (error) {
    console.error('Failed to list folders:', error);
    res.status(500).json({ 
      error: 'Failed to list folders',
      message: error.message 
    });
  }
});

// Add this test endpoint
app.get('/test-b2-auth', async (req, res) => {
  try {
    const authResponse = await authorizeB2();
    res.json({ 
      message: 'B2 authorization successful',
      apiUrl: authResponse.apiUrl 
    });
  } catch (error) {
    console.error('B2 auth test error:', error);
    res.status(500).json({ 
      error: 'Failed to authorize with B2',
      details: error.message 
    });
  }
});

// Add this endpoint for folder listing
app.get('/api/folders', async (req, res) => {
  try {
    // Get B2 authorization
    const authResponse = await authorizeB2();
    
    // List files to get folders
    const response = await axios({
      method: 'post',
      url: `${authResponse.apiUrl}/b2api/v3/b2_list_file_names`,
      headers: {
        Authorization: authResponse.authorizationToken
      },
      data: {
        bucketId: process.env.B2_BUCKET_ID,
        delimiter: '/',
        prefix: ''
      }
    });

    // Extract unique folders from file paths
    const folders = new Set();
    
    // Add folders from files
    response.data.files.forEach(file => {
      const path = file.fileName;
      const folderPath = path.split('/').slice(0, -1).join('/');
      if (folderPath) folders.add(folderPath);
    });

    // Add folders from common prefixes
    if (response.data.commonPrefixes) {
      response.data.commonPrefixes.forEach(prefix => {
        folders.add(prefix.replace(/\/$/, '')); // Remove trailing slash
      });
    }

    const sortedFolders = Array.from(folders).sort();
    res.json({ folders: sortedFolders });
  } catch (error) {
    console.error('Failed to list folders:', error);
    res.status(500).json({ 
      error: 'Failed to list folders',
      message: error.message 
    });
  }
});

// Add a retry utility function
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Increase delay for next attempt
      delay *= 2;
    }
  }
}

// Update the b2/folders endpoint with retry logic
app.get('/b2/folders', async (req, res) => {
  try {
    const { path } = req.query;
    
    // Remove leading slash if it exists and ensure trailing slash for non-empty paths
    const cleanPath = path ? path.replace(/^\/+/, '') : '';
    const prefix = cleanPath ? (cleanPath.endsWith('/') ? cleanPath : `${cleanPath}/`) : '';

    console.log('Listing contents for path:', {
      originalPath: path,
      cleanPath: cleanPath,
      prefix: prefix
    });

    const listFiles = async () => {
      const authData = await authorizeB2();
      const apiUrl = authData.apiInfo.storageApi.apiUrl;

      const response = await axios({
        method: 'post',
        url: `${apiUrl}/b2api/v3/b2_list_file_names`,
        headers: {
          Authorization: authData.authorizationToken
        },
        data: {
          bucketId: process.env.B2_BUCKET_ID,
          delimiter: '/',
          prefix: prefix,
          maxFileCount: 10000
        },
        timeout: 10000, // Add timeout
        validateStatus: status => status === 200 // Only accept 200 status
      });

      return response;
    };

    // Use retry logic for the API call
    const response = await retryOperation(listFiles);

    console.log('B2 Response:', {
      files: response.data.files.map(f => f.fileName),
      commonPrefixes: response.data.commonPrefixes
    });

    const folders = new Set();
    const files = [];

    // Process files
    response.data.files.forEach(file => {
      const fileName = file.fileName;
      
      if (fileName.startsWith(prefix)) {
        const relativePath = fileName.slice(prefix.length);
        
        if (!relativePath.includes('/')) {
          files.push({
            name: relativePath,
            size: file.contentLength,
            uploadTimestamp: file.uploadTimestamp,
            fileId: file.fileId
          });
        } else {
          const nextFolder = relativePath.split('/')[0];
          if (nextFolder) {
            folders.add(nextFolder);
          }
        }
      }
    });

    // Process common prefixes
    if (response.data.commonPrefixes) {
      response.data.commonPrefixes.forEach(prefix => {
        const folderPath = prefix.replace(/\/$/, '');
        const folderName = folderPath.split('/').pop();
        if (folderName) {
          folders.add(folderName);
        }
      });
    }

    const sortedFolders = Array.from(folders).sort();
    const sortedFiles = files.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      folders: sortedFolders,
      files: sortedFiles
    });

  } catch (error) {
    console.error('B2 folder list error:', error);
    res.status(500).json({ 
      error: 'Failed to list folders and files',
      details: error.message
    });
  }
});

// Create folder by uploading a zero-byte file
app.post('/b2/create-folder', async (req, res) => {
  try {
    const { folderName } = req.body;
    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    // Clean the folder name
    const cleanFolderName = folderName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9/]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^\/+|\/+$/g, '');

    const authResponse = await authorizeB2();
    const apiUrl = authResponse.apiInfo.storageApi.apiUrl;

    // Get upload URL
    const uploadUrlResponse = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v3/b2_get_upload_url`,
      headers: {
        Authorization: authResponse.authorizationToken
      },
      data: {
        bucketId: process.env.B2_BUCKET_ID
      }
    });

    // Upload empty file
    await axios({
      method: 'post',
      url: uploadUrlResponse.data.uploadUrl,
      headers: {
        Authorization: uploadUrlResponse.data.authorizationToken,
        'Content-Type': 'application/x-empty',
        'Content-Length': '0',
        'X-Bz-File-Name': encodeURIComponent(`${cleanFolderName}/.bzEmpty`),
        'X-Bz-Content-Sha1': 'da39a3ee5e6b4b0d3255bfef95601890afd80709' // SHA1 of empty string
      }
    });

    res.json({ 
      message: 'Folder created successfully',
      folderName: cleanFolderName
    });

  } catch (error) {
    console.error('Failed to create folder:', error);
    res.status(500).json({ 
      error: 'Failed to create folder', 
      details: error.message 
    });
  }
});

// Delete a file
app.delete('/b2/file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { fileName } = req.query;

    if (!fileId || !fileName) {
      return res.status(400).json({ 
        error: 'Both fileId and fileName are required' 
      });
    }

    const authResponse = await authorizeB2();
    const apiUrl = authResponse.apiInfo.storageApi.apiUrl;

    console.log('Deleting file:', { fileId, fileName });

    // Get file info first to verify the file exists
    const fileInfoResponse = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v3/b2_get_file_info`,
      headers: {
        Authorization: authResponse.authorizationToken
      },
      data: {
        fileId: fileId
      }
    });

    console.log('File info:', fileInfoResponse.data);

    // Delete the file
    await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v3/b2_delete_file_version`,
      headers: {
        Authorization: authResponse.authorizationToken
      },
      data: {
        fileId: fileId,
        fileName: fileName
      }
    });

    res.json({ 
      message: 'File deleted successfully',
      fileId,
      fileName
    });
  } catch (error) {
    console.error('Failed to delete file:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to delete file', 
      details: error.response?.data?.message || error.message,
      requestData: {
        fileId: req.params.fileId,
        fileName: req.query.fileName
      }
    });
  }
});

// Delete a folder and its contents
app.delete('/b2/folder/:folderPath(*)', async (req, res) => {
  try {
    const { folderPath } = req.params;
    const cleanPath = folderPath.replace(/^\/+|\/+$/g, '');

    const authResponse = await authorizeB2();
    const apiUrl = authResponse.apiInfo.storageApi.apiUrl;

    // List all files in the folder
    const response = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v3/b2_list_file_names`,
      headers: {
        Authorization: authResponse.authorizationToken
      },
      data: {
        bucketId: process.env.B2_BUCKET_ID,
        prefix: `${cleanPath}/`,
        maxFileCount: 10000
      }
    });

    // Delete all files in the folder
    const deletePromises = response.data.files.map(file => 
      axios({
        method: 'post',
        url: `${apiUrl}/b2api/v3/b2_delete_file_version`,
        headers: {
          Authorization: authResponse.authorizationToken
        },
        data: {
          fileId: file.fileId,
          fileName: file.fileName
        }
      })
    );

    await Promise.all(deletePromises);

    res.json({ message: 'Folder deleted successfully' });
  } catch (error) {
    console.error('Failed to delete folder:', error);
    res.status(500).json({ 
      error: 'Failed to delete folder', 
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 