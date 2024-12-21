import { uploadToB2 } from './utils'; // Ensure you have a utility function for B2 uploads

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { folderName } = req.body;
  if (!folderName) {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  try {
    // Use a placeholder file to create the folder
    const placeholderFileName = '.keep';
    const b2Response = await uploadToB2(placeholderFileName, folderName);

    res.json({ message: 'Folder created successfully', b2Response });
  } catch (error) {
    console.error('Failed to create folder:', error);
    res.status(500).json({ error: 'Failed to create folder', details: error.message });
  }
} 