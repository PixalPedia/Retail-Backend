const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { supabase } = require('../supabaseClient'); // Import Supabase
const router = express.Router();

// Multer Setup for File Uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 4 * 1024 * 1024 }, // Max 4 MB per file
});

// Helper Function: Compress and Upload Images
const uploadImageToSupabase = async (buffer, fileName) => {
    try {
        console.log('Compressing image...');
        const compressedImage = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside' })
            .jpeg({ quality: 80 })
            .toBuffer();

        console.log('Uploading image to Supabase...');
        const timestamp = Date.now();
        const filePath = `posters/${timestamp}-${fileName}`;
        const { data, error } = await supabase.storage
            .from('images') // Ensure the bucket name is 'images'
            .upload(filePath, compressedImage, {
                cacheControl: '3600',
                upsert: false,
                contentType: 'image/jpeg',
            });

        if (error) {
            console.error('Supabase Upload Error:', error.message);
            throw new Error('Image upload failed.');
        }

        console.log('Constructing public URL...');
        const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/images/${filePath}`;

        console.log(`Image successfully uploaded: ${publicUrl}`);
        return publicUrl;
    } catch (err) {
        console.error('Error during image upload:', err.message);
        throw err;
    }
};

// Helper Function: Check Superuser Permissions
const isSuperUser = async (user_id) => {
    try {
        const { data: superuser, error } = await supabase
            .from('superusers') // Reference the superusers table
            .select('id')
            .eq('id', user_id)
            .single();

        if (error || !superuser) {
            console.error('Superuser Check Failed:', error?.message || 'Superuser not found');
            return false;
        }

        console.log(`Superuser verified: ${user_id}`);
        return true;
    } catch (err) {
        console.error('Unexpected error while checking superuser:', err.message);
        return false;
    }
};

// Add Poster
router.post('/add', upload.single('desktopPoster'), async (req, res) => {
    const { user_id, product_id } = req.body;
    const file = req.file; // Only one file input is used for desktop poster

    try {
        // Check Superuser Permissions
        if (!(await isSuperUser(user_id))) {
            return res.status(403).json({ error: 'Only superusers are allowed to add posters.' });
        }

        // Validate Inputs
        if (!product_id || isNaN(product_id)) {
            return res.status(400).json({ error: 'A valid product ID is required.' });
        }
        if (!file) {
            return res.status(400).json({ error: 'Desktop poster image is required.' });
        }

        // Check if the product already has 6 posters
        const { data: posterCount, error: countError } = await supabase
            .from('posters')
            .select('id', { count: 'exact' })
            .eq('product_id', product_id);

        if (countError) {
            console.error('Error fetching poster count:', countError.message);
            return res.status(500).json({ error: 'Failed to check poster count in the database.' });
        }

        if (posterCount >= 6) {
            return res.status(400).json({ error: 'This product already has 6 posters. No more posters can be uploaded.' });
        }

        // Upload Desktop Poster
        const desktopPosterUrl = await uploadImageToSupabase(
            file.buffer,
            `poster_${product_id}_desktop_${new Date().getTime()}.jpg`
        );

        // Insert Poster into `posters` Table
        const { data: posterData, error: posterError } = await supabase
            .from('posters')
            .insert([{
                product_id: parseInt(product_id),
                poster_desktop_url: desktopPosterUrl,
            }])
            .select();

        if (posterError) {
            console.error('Error adding poster to database:', posterError.message);
            return res.status(500).json({ error: 'Failed to add poster to the database.' });
        }

        res.status(201).json({
            message: 'Poster added successfully!',
            poster: posterData[0]
        });
    } catch (err) {
        console.error('Unexpected Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Delete Poster
router.delete('/delete', async (req, res) => {
    const { user_id, poster_id } = req.body; // Extract `user_id` and `poster_id` from request body

    try {
        // Check Superuser Permissions
        if (!(await isSuperUser(user_id))) {
            return res.status(403).json({ error: 'Only superusers are allowed to delete posters.' });
        }

        // Validate Poster ID
        if (!poster_id || isNaN(poster_id)) {
            return res.status(400).json({ error: 'A valid poster ID is required.' });
        }

        // Fetch the poster details from the database
        const { data: poster, error: fetchError } = await supabase
            .from('posters')
            .select('poster_desktop_url')
            .eq('id', parseInt(poster_id))
            .single();

        if (fetchError || !poster) {
            console.error('Error fetching poster details:', fetchError?.message || 'Poster not found.');
            return res.status(404).json({ error: 'Poster not found.' });
        }

        // Extract the file path from the URL (specific to "posters" folder in "images" bucket)
        const desktopPosterPath = poster.poster_desktop_url.split('/images/posters/')[1]; // Extract path after "images/posters/"

        // Delete desktop poster image from Supabase storage bucket
        const { error: storageError } = await supabase.storage
            .from('images') // Ensure "images" matches your bucket name
            .remove([`posters/${desktopPosterPath}`]); // Add "posters/" prefix to delete from the correct folder

        if (storageError) {
            console.error('Error deleting poster from storage:', storageError.message);
            return res.status(500).json({ error: 'Failed to delete poster from storage.' });
        }

        // Delete poster entry from the database
        const { error: deleteError } = await supabase
            .from('posters')
            .delete()
            .eq('id', parseInt(poster_id));

        if (deleteError) {
            console.error('Error deleting poster from database:', deleteError.message);
            return res.status(500).json({ error: 'Failed to delete poster from the database.' });
        }

        res.status(200).json({
            message: 'Poster and its associated image deleted successfully!'
        });
    } catch (err) {
        console.error('Unexpected Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch All Posters
router.get('/all', async (req, res) => {
    try {
        // Fetch all posters from the database
        const { data: posters, error } = await supabase
            .from('posters')
            .select('id, product_id, poster_desktop_url, created_at');

        if (error) {
            console.error('Error fetching posters:', error.message);
            return res.status(500).json({ error: 'Failed to fetch posters.' });
        }

        // Handle the case where no posters are found
        if (!posters || posters.length === 0) {
            return res.status(404).json({ error: 'No posters found.' });
        }

        res.status(200).json({
            message: 'Posters fetched successfully!',
            posters
        });
    } catch (err) {
        console.error('Unexpected Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Poster by ID
router.post('/fetch', async (req, res) => {
    const { poster_id } = req.body; // Extract `poster_id` from request body

    try {
        // Validate Poster ID
        if (!poster_id || isNaN(poster_id)) {
            return res.status(400).json({ error: 'A valid poster ID is required.' });
        }

        // Fetch poster details by ID
        const { data: poster, error } = await supabase
            .from('posters')
            .select('id, product_id, poster_desktop_url, created_at')
            .eq('id', parseInt(poster_id))
            .single();

        if (error || !poster) {
            console.error(`Error fetching poster with ID ${poster_id}:`, error?.message || 'Poster not found');
            return res.status(404).json({ error: 'Poster not found.' });
        }

        res.status(200).json({
            message: 'Poster fetched successfully!',
            poster
        });
    } catch (err) {
        console.error('Unexpected Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
