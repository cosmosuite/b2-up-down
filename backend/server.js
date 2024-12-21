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
async function uploadToB2(filePath, fileName, folder = '') {
  try {
    // Get authorization
    const authResponse = await authorizeB2();
    const apiUrl = authResponse.apiInfo.storageApi.apiUrl;

    // Prepare B2 file name with folder path
    const b2FileName = folder 
      ? `${folder.replace(/^\/+|\/+$/g, '')}/${fileName}` // Remove leading/trailing slashes
      : fileName;

    console.log('Uploading to B2 with file name:', b2FileName);

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

    console.log('Upload URL response:', uploadUrlResponse.data);

    // Read file
    const fileBuffer = await fsPromises.readFile(filePath);
    const fileSize = fileBuffer.length;

    // Upload file
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

    console.log('Upload response:', uploadResponse.data);

    return {
      fileId: uploadResponse.data.fileId,
      fileName: uploadResponse.data.fileName,
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
      url: `${authResponse.apiUrl}/b2api/v2/b2_list_file_names`,
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
    const { fileUrl, folder } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({ error: 'File URL is required' });
    }

    console.log('Attempting to download:', fileUrl);
    console.log('Target folder:', folder || 'root');
    
    const fileName = path.basename(fileUrl);
    const filePath = path.join(tempDir, fileName);

    console.log('Saving to:', filePath);

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

      const writer = response.data.pipe(fs.createWriteStream(filePath));
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', (err) => {
          console.error('Write stream error:', err);
          reject(err);
        });
      });

      console.log('File downloaded successfully, uploading to B2...');

      // Upload to B2 with folder path
      const b2Response = await uploadToB2(filePath, fileName, folder);

      // Clean up temp file
      await fsPromises.unlink(filePath);

      res.json({ 
        message: 'File processed successfully',
        fileName,
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
      url: `${authResponse.apiUrl}/b2api/v2/b2_list_file_names`,
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

// Add B2 folder listing endpoint
app.get('/b2/folders', async (req, res) => {
  try {
    const authData = await authorizeB2();
    const apiUrl = authData.apiInfo.storageApi.apiUrl;
    if (!apiUrl) {
      throw new Error('Authorization failed: apiUrl is missing');
    }
    const response = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v3/b2_list_file_names`,
      headers: {
        Authorization: authData.authorizationToken
      },
      data: {
        bucketId: process.env.B2_BUCKET_ID,
        delimiter: '/',
        prefix: ''
      }
    });

    const uniqueFolders = new Set();
    response.data.files.forEach(file => {
      const pathParts = file.fileName.split('/');
      if (pathParts.length > 1) {
        const folderPath = pathParts.slice(0, -1).join('/');
        uniqueFolders.add(folderPath);
      }
    });

    if (response.data.commonPrefixes) {
      response.data.commonPrefixes.forEach(prefix => {
        uniqueFolders.add(prefix.replace(/\/$/, ''));
      });
    }

    const sortedFolders = Array.from(uniqueFolders).sort();
    res.json({ folders: sortedFolders });

  } catch (error) {
    console.error('B2 folder list error:', error);
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

app.post('/b2/create-folder', async (req, res) => {
  try {
    const { folderName } = req.body;
    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    // Use a placeholder file to create the folder
    const placeholderFileName = '.keep';
    const filePath = path.join(tempDir, placeholderFileName);

    // Create a temporary placeholder file
    await fsPromises.writeFile(filePath, '');

    // Upload the placeholder file to B2
    const b2Response = await uploadToB2(filePath, placeholderFileName, folderName);

    // Clean up the temporary file
    await fsPromises.unlink(filePath);

    res.json({ message: 'Folder created successfully', b2Response });
  } catch (error) {
    console.error('Failed to create folder:', error);
    res.status(500).json({ error: 'Failed to create folder', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 