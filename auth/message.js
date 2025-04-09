const express = require('express');
const { supabase } = require('../supabaseClient');
const router = express.Router();

// Helper Function: Check Superuser
const isSuperUser = async (user_id) => {
    try {
        const { data: superuser, error } = await supabase
            .from('superusers')
            .select('*')
            .eq('id', user_id)
            .single();
        if (error) {
            console.error('Superuser Check Error:', error.message);
            return false;
        }
        return superuser !== null;
    } catch (err) {
        console.error('Unexpected Error in Superuser Check:', err.message);
        return false;
    }
};

// Helper Function: Sanitize File Name
const sanitizeFileName = (fileName) => {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_'); // Replace unsupported characters with underscores
};

// Helper Function: Compress and Upload Images to Supabase
const uploadImageToSupabase = async (buffer, fileName) => {
    try {
        console.log('Compressing image...');
        const compressedImage = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside' }) // Resize within 1024x1024
            .jpeg({ quality: 80 }) // Compress with 80% quality
            .toBuffer();

        console.log('Sanitizing file name...');
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_'); // Remove invalid characters
        const timestamp = Date.now(); // Ensure unique file path
        const filePath = `messages/${timestamp}-${sanitizedFileName}`;

        console.log('Uploading image to Supabase...');
        const { data, error } = await supabase.storage
            .from('images') // Make sure the 'images' bucket exists
            .upload(filePath, compressedImage, {
                cacheControl: '3600', // Cache for 1 hour
                upsert: false, // Prevent overwriting existing files
                contentType: 'image/jpeg', // Explicitly set image MIME type
            });

        if (error) {
            console.error('Supabase Upload Error:', error.message);
            throw new Error('Image upload failed.');
        }

        console.log('Constructing public URL...');
        const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/images/${filePath}`;
        return publicUrl;
    } catch (err) {
        console.error('Error during image upload:', err.message);
        throw err;
    }
};

const deleteMessage = async (messageId) => {
    try {
        // Step 1: Fetch the message details
        const { data: messageData, error: fetchError } = await supabase
            .from('messages')
            .select('*')
            .eq('id', messageId)
            .single();

        if (fetchError || !messageData) {
            console.error('Error Fetching Message:', fetchError?.message);
            throw new Error('Message not found.');
        }

        // Step 2: Remove the associated image (if present)
        if (messageData.image_url) {
            const imageFilePath = messageData.image_url.split('/storage/v1/object/public/images/')[1];
            const { error: deleteImageError } = await supabase.storage
                .from('images') // Ensure this bucket name is correct
                .remove([imageFilePath]);

            if (deleteImageError) {
                console.error('Image Deletion Error:', deleteImageError.message);
                throw new Error('Failed to delete associated image.');
            }
        }

        // Step 3: Delete the message from the database
        const { error: deleteMessageError } = await supabase
            .from('messages')
            .delete()
            .eq('id', messageId);

        if (deleteMessageError) {
            console.error('Message Deletion Error:', deleteMessageError.message);
            throw new Error('Failed to delete the message.');
        }

        return { success: true, message: 'Message deleted successfully.' };
    } catch (err) {
        console.error('Error Deleting Message:', err.message);
        return { success: false, error: err.message };
    }
};

// ---------------------------------------------------------------------------
// Add New Message (General or Linked to an Order)
// ---------------------------------------------------------------------------
router.post('/send', upload.single('image'), async (req, res) => {
    const { orderId, sender_id, message } = req.body;
    const imageFile = req.file;

    // Validate inputs
    if (!sender_id || (!message && !imageFile)) {
        return res.status(400).json({ error: 'Sender ID and either a message or an image are required.' });
    }

    try {
        let imageUrl = null;

        // Upload image if provided
        if (imageFile) {
            try {
                console.log('Uploading image...');
                imageUrl = await uploadImageToSupabase(imageFile.buffer, `message_${Date.now()}_${imageFile.originalname}`);
            } catch (err) {
                console.error('Image Upload Error:', err.message);
                return res.status(500).json({ error: 'Failed to upload image.' });
            }
        }

        // Insert message into the messages table
        const messageInsert = await supabase
            .from('messages')
            .insert([{
                sender: sender_id,
                message: message || null,
                image_url: imageUrl || null,
                read_status: false, // Message starts as unread
                is_edited: false, // No edits yet
            }])
            .select();

        if (messageInsert.error) {
            console.error('Message Insert Error:', messageInsert.error.message);
            return res.status(500).json({ error: 'Failed to save the message.' });
        }

        const messageData = messageInsert.data[0]; // Extract newly created message

        // If orderId is provided, link the message to the order
        if (orderId) {
            const orderMessageInsert = await supabase
                .from('order_messages')
                .insert([{
                    order_id: parseInt(orderId),
                    message_id: messageData.id, // ID of the new message
                }]);

            if (orderMessageInsert.error) {
                console.error('Order Link Error:', orderMessageInsert.error.message);
                return res.status(500).json({ error: 'Failed to link the message to the order.' });
            }
        }

        // Return successful response
        res.status(201).json({
            message: 'Message sent successfully!',
            messageData,
        });
    } catch (err) {
        console.error('Unexpected Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ---------------------------------------------------------------------------
// Fetch All Messages (General or Order-Specific)
// ---------------------------------------------------------------------------
router.post('/list', async (req, res) => {
    const { orderId, sender_id, superuser_id } = req.body;

    try {
        let query;

        // Check if sender is a superuser
        let isSuperUser = false;
        if (superuser_id) {
            const { data: superuserData, error: superuserError } = await supabase
                .from('superusers')
                .select('*')
                .eq('id', superuser_id)
                .single();

            if (superuserError) {
                console.error('Error Checking Superuser:', superuserError.message);
                return res.status(403).json({ error: 'Superuser validation failed.' });
            }

            isSuperUser = !!superuserData; // Superuser is valid if data exists
        }

        if (orderId) {
            // Fetch messages linked to an order
            query = supabase
                .from('messages')
                .select('*')
                .eq('order_id', parseInt(orderId))
                .order('created_at', { ascending: true });
        } else if (isSuperUser) {
            // Fetch all general messages (for superuser)
            query = supabase
                .from('messages')
                .select('*')
                .order('created_at', { ascending: true });
        } else {
            // Fetch all messages for the specific user (sender_id)
            query = supabase
                .from('messages')
                .select('*')
                .eq('sender', sender_id)
                .order('created_at', { ascending: true });
        }

        const { data: messages, error } = await query;

        if (error) {
            console.error('Error Fetching Messages:', error.message);
            return res.status(500).json({ error: 'Failed to fetch messages.' });
        }

        res.status(200).json({ message: 'Messages fetched successfully!', messages });
    } catch (err) {
        console.error('Unexpected Error in Fetch Messages:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ---------------------------------------------------------------------------
// Edit an Existing Message
// ---------------------------------------------------------------------------
router.patch('/edit', upload.single('image'), async (req, res) => {
    const { messageId, sender_id, newMessage } = req.body;
    const imageFile = req.file; // New image file (if provided)
    const removeImage = req.body.removeImage === 'true'; // Optional flag to remove the image

    // Validate inputs
    if (!messageId || !sender_id || (!newMessage && !imageFile && !removeImage)) {
        return res.status(400).json({ error: 'Message ID, sender ID, and either new content, an image, or removeImage flag are required.' });
    }

    try {
        // Fetch the original message
        const { data: originalMessage, error: fetchError } = await supabase
            .from('messages')
            .select('*')
            .eq('id', parseInt(messageId))
            .single();

        if (fetchError || !originalMessage) {
            console.error('Message Not Found or Fetch Error:', fetchError?.message);
            return res.status(404).json({ error: 'Message not found.' });
        }

        // Handle edit history insertion
        const { error: editHistoryError } = await supabase
            .from('edited_messages')
            .insert([{
                original_message_id: messageId,
                old_message: originalMessage.message,
                new_message: newMessage || originalMessage.message,
                edited_by: sender_id,
            }]);

        if (editHistoryError) {
            console.error('Edit History Insert Error:', editHistoryError.message);
            return res.status(500).json({ error: 'Failed to save edit history.' });
        }

        // Handle image updates (if applicable)
        let newImageUrl = originalMessage.image_url; // Default to existing image URL

        if (imageFile) {
            // Upload the new image
            try {
                console.log('Uploading new image...');
                newImageUrl = await uploadImageToSupabase(imageFile.buffer, `message_${Date.now()}_${imageFile.originalname}`);

                // Delete the old image if it exists
                if (originalMessage.image_url) {
                    const oldFilePath = originalMessage.image_url.split('/storage/v1/object/public/images/')[1];
                    const { error: deleteError } = await supabase.storage
                        .from('images') // Bucket name
                        .remove([oldFilePath]);

                    if (deleteError) {
                        console.error('Old Image Deletion Error:', deleteError.message);
                        return res.status(500).json({ error: 'Failed to delete old image.' });
                    }
                }
            } catch (err) {
                console.error('Image Upload Error:', err.message);
                return res.status(500).json({ error: 'Failed to upload new image.' });
            }
        } else if (removeImage && originalMessage.image_url) {
            // Remove the existing image if requested
            const oldFilePath = originalMessage.image_url.split('/storage/v1/object/public/images/')[1];
            const { error: deleteError } = await supabase.storage
                .from('images') // Bucket name
                .remove([oldFilePath]);

            if (deleteError) {
                console.error('Image Removal Error:', deleteError.message);
                return res.status(500).json({ error: 'Failed to remove existing image.' });
            }

            newImageUrl = null; // Set image_url to null
        }

        // Update the message with new content
        const { data: updatedMessage, error: updateError } = await supabase
            .from('messages')
            .update({
                message: newMessage || originalMessage.message,
                image_url: newImageUrl,
                updated_at: new Date(),
                is_edited: true,
            })
            .eq('id', parseInt(messageId))
            .select();

        if (updateError) {
            console.error('Message Update Error:', updateError.message);
            return res.status(500).json({ error: 'Failed to update the message.' });
        }

        res.status(200).json({
            message: 'Message edited successfully!',
            updatedMessage: updatedMessage[0],
        });
    } catch (err) {
        console.error('Unexpected Error in Edit Message:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ---------------------------------------------------------------------------
// Delete a Message
// ---------------------------------------------------------------------------
router.delete('/delete', async (req, res) => {
    const { messageId } = req.body;

    // Validate input
    if (!messageId) {
        return res.status(400).json({ error: 'Message ID is required.' });
    }

    try {
        const result = await deleteMessage(messageId);

        if (result.success) {
            res.status(200).json({ message: result.message });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (err) {
        console.error('Unexpected Error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
