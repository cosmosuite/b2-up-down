import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

console.log('Environment variables loaded:', {
  B2_KEY_ID: process.env.B2_KEY_ID ? 'Set' : 'Not set',
  B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY ? 'Set' : 'Not set',
  B2_BUCKET_ID: process.env.B2_BUCKET_ID ? 'Set' : 'Not set',
  B2_BUCKET_NAME: process.env.B2_BUCKET_NAME ? 'Set' : 'Not set'
});

const app = express();
const PORT = 5005;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

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

// Update the b2/folders endpoint with retry logic
app.get('/b2/folders', async (req, res) => {
  try {
    const { path } = req.query;
    const cleanPath = path ? path.replace(/^\/+/, '') : '';
    const prefix = cleanPath ? (cleanPath.endsWith('/') ? cleanPath : `${cleanPath}/`) : '';

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
        timeout: 10000,
        validateStatus: status => status === 200
      });

      console.log('B2 API Response:', response.data);
      return response;
    };

    const response = await retryOperation(listFiles);

    const folders = new Set();
    const files = [];

    response.data.files.forEach(file => {
      const fileName = file.fileName;
      if (fileName.startsWith(prefix) && !fileName.endsWith('.bzEmpty')) {
        const relativePath = fileName.slice(prefix.length);
        if (!relativePath.includes('/')) {
          files.push({
            name: relativePath,
            fullPath: fileName,
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

    console.log('Processed Folders:', sortedFolders);
    console.log('Processed Files:', sortedFiles);

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 