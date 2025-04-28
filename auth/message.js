const express = require('express');
const multer = require('multer');
const sharp = require('sharp'); // For image processing
const { supabase } = require('../supabaseClient');
const router = express.Router();

// Multer setup for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Helper Function: Sanitize File Name
const sanitizeFileName = (fileName) => {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_'); // Replace unsupported characters with underscores
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

// Helper Function: Compress and Upload Images to Supabase
const uploadImageToSupabase = async (buffer, fileName) => {
    try {
        console.log('Compressing image...');
        const compressedImage = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside' }) // Resize within 1024x1024
            .jpeg({ quality: 80 }) // Compress with 80% quality
            .toBuffer();

        console.log('Sanitizing file name...');
        const sanitizedFileName = sanitizeFileName(fileName);
        const timestamp = Date.now();
        const filePath = `messages/${timestamp}-${sanitizedFileName}`;

        console.log('Uploading image to Supabase...');
        const { data, error } = await supabase.storage
            .from('images') // Ensure the 'images' bucket exists
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

// Helper Function: Delete Message and Associated Image
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

// Create Converation 
router.post('/conversation/create', async (req, res) => {
    const { user_id } = req.body; // User inputs only their ID

    // Validate required input
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required to start a conversation.' });
    }

    try {
        // Step 1: Fetch the default superuser ID
        const { data: superuser, error: superuserError } = await supabase
            .from('superusers')
            .select('id') // Fetch the `id` column from the superusers table
            .limit(1) // Fetch the first superuser (or default one)
            .single();

        if (superuserError || !superuser) {
            console.error('Superuser Fetch Error:', superuserError?.message);
            return res.status(500).json({ error: 'Failed to fetch superuser.' });
        }

        const superuser_id = superuser.id;

        // Step 2: Check if a conversation already exists between the user and the superuser
        const { data: existingConversation, error: conversationError } = await supabase
            .from('conversations')
            .select('*')
            .eq('user_id', user_id)
            .eq('superuser_id', superuser_id)
            .single();

        if (conversationError && conversationError.code !== 'PGRST116') {
            console.error('Conversation Check Error:', conversationError.message);
            return res.status(500).json({ error: 'Failed to check for an existing conversation.' });
        }

        if (existingConversation) {
            // Step 3: Return the existing conversation
            return res.status(200).json({
                message: 'Conversation already exists.',
                conversation: existingConversation,
            });
        }

        // Step 4: Create a new conversation
        const conversationInsert = await supabase
            .from('conversations')
            .insert([
                {
                    user_id,
                    superuser_id,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            ])
            .select();

        if (conversationInsert.error) {
            console.error('Conversation Insert Error:', conversationInsert.error.message);
            return res.status(500).json({ error: 'Failed to create a new conversation.' });
        }

        res.status(201).json({
            message: 'New conversation created successfully!',
            conversation: conversationInsert.data[0],
        });
    } catch (err) {
        console.error('Unexpected Error in Conversation Creation:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Update Read Status
router.put('/read', async (req, res) => {
    const { messageId } = req.body;
  
    // Validate input
    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required.' });
    }
  
    try {
      // Update the read_status to true for the specified message
      const { data, error } = await supabase
        .from('messages')
        .update({ read_status: true }) // Set read_status to true
        .eq('id', parseInt(messageId, 10)) // Match the message ID
        .select(); // Return the updated message
  
      if (error) {
        console.error('Error updating read status:', error.message);
        return res.status(500).json({ error: 'Failed to update read status.' });
      }
  
      if (!data.length) {
        return res.status(404).json({ error: 'Message not found or unauthorized.' });
      }
  
      // Optional: Emit a real-time Socket.IO update for this message read event.
      const io = req.app.get('io');
      if (io) {
        // You can choose to emit the event to a specific room or broadcast to all connected clients.
        // For example: io.to(`conversation_${conversationId}`).emit('messageRead', data[0]);
        // Here we'll broadcast to all connected clients:
        io.emit('messageRead', data[0]);
      }
  
      res.status(200).json({ 
        message: 'Read status updated successfully!',
        updatedMessage: data 
      });
    } catch (err) {
      console.error('Unexpected error:', err.message);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });  

// Endpoint for regular users to send a message
router.post('/send', upload.single('image'), async (req, res) => {
    const { orderId, conversation_id, sender_id, message } = req.body;
    const imageFile = req.file;
  
    // Validate required inputs
    if (!sender_id || (!message && !imageFile)) {
      return res.status(400).json({
        error: 'SenderID and either a message or image are required.'
      });
    }
    if (!orderId && !conversation_id) {
      return res.status(400).json({
        error: 'Either orderID or conversationID is required.'
      });
    }
  
    try {
      let imageUrl = null;
  
      // Step 1: Handle image upload if provided
      if (imageFile) {
        try {
          console.log('Uploading image...');
          imageUrl = await uploadImageToSupabase(
            imageFile.buffer, // Access the image buffer from the file
            `message_${Date.now()}_${imageFile.originalname}` // Create a unique filename
          );
        } catch (err) {
          console.error('Image Upload Error:', err.message);
          return res.status(500).json({ error: 'Failed to upload image.' });
        }
      }
  
      // Step 2: Insert the message into the 'messages' table
      const messageInsert = await supabase.from('messages').insert([
        {
          sender: sender_id,
          message: message?.trim() || null, // Store the message text if provided
          image_url: imageUrl || null, // Store the uploaded image URL if provided
          read_status: false, // Default read status
          is_edited: false, // Message is not edited initially
          created_at: new Date() // Timestamp for message creation
        }
      ]).select();
  
      if (messageInsert.error) {
        console.error('Message Insert Error:', messageInsert.error.message);
        return res.status(500).json({ error: 'Failed to save the message.' });
      }
      const messageData = messageInsert.data[0];
  
      // Step 3: Link the message to either an order or a conversation
      if (orderId) {
        const orderMessageInsert = await supabase.from('order_messages').insert([
          {
            order_id: parseInt(orderId, 10),
            message_id: messageData.id,
            linked_at: new Date() // Timestamp for linking
          }
        ]);
        if (orderMessageInsert.error) {
          console.error('Order Link Error:', orderMessageInsert.error.message);
          return res.status(500).json({ error: 'Failed to link the message to the order.' });
        }
      }
  
      if (conversation_id) {
        const conversationMessageInsert = await supabase.from('conversation_messages').insert([
          {
            conversation_id: parseInt(conversation_id, 10),
            message_id: messageData.id,
            added_at: new Date() // Timestamp for linking
          }
        ]);
        if (conversationMessageInsert.error) {
          console.error('Conversation Link Error:', conversationMessageInsert.error.message);
          return res.status(500).json({ error: 'Failed to link the message to the conversation.' });
        }
        // Update conversation's updated_at timestamp
        const conversationUpdate = await supabase.from('conversations')
          .update({ updated_at: new Date() })
          .eq('conversation_id', parseInt(conversation_id, 10));
        if (conversationUpdate.error) {
          console.error('Conversation Timestamp Update Error:', conversationUpdate.error.message);
          return res.status(500).json({ error: 'Failed to update the conversation timestamp.' });
        }
      }
  
      // Step 4: Emit the 'newMessage' event via Socket.IO so that the frontend receives the update automatically.
      const io = req.app.get('io');
      if (io) {
        if (orderId) {
          io.to(`order_${orderId}`).emit('newMessage', messageData);
        }
        if (conversation_id) {
          io.to(`conversation_${conversation_id}`).emit('newMessage', messageData);
        }
      }
  
      // Step 5: Return success response with the message data.
      res.status(201).json({ message: 'Message sent successfully!', messageData });
  
    } catch (err) {
      console.error('Unexpected Error in Message Sending:', err.message);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });
  
  
  // Endpoint for superusers to send a message
router.post('/superuser/send', upload.single('image'), async (req, res) => {
    const { superuser_id, orderId, conversation_id, message } = req.body;
    const imageFile = req.file;
  
    // Validate required inputs
    if (!superuser_id || (!message && !imageFile)) {
      return res.status(400).json({
        error: 'SuperuserID and either a message or image are required.'
      });
    }
    if (!orderId && !conversation_id) {
      return res.status(400).json({
        error: 'Either orderID or conversationID is required.'
      });
    }
  
    try {
      // Step 1: Check Superuser permissions
      const isAuthorized = await isSuperUser(superuser_id);
      if (!isAuthorized) {
        return res.status(403).json({ error: 'Unauthorized superuser.' });
      }
  
      let imageUrl = null;
  
      // Step 2: Upload image if provided
      if (imageFile) {
        try {
          console.log('Uploading image...');
          imageUrl = await uploadImageToSupabase(
            imageFile.buffer,
            `superuser_${Date.now()}_${imageFile.originalname}`
          );
        } catch (err) {
          console.error('Image Upload Error:', err.message);
          return res.status(500).json({ error: 'Failed to upload image.' });
        }
      }
  
      // Step 3: Insert the message into the 'messages' table
      const messageInsert = await supabase.from('messages').insert([
        {
          sender: superuser_id, // Set superuser as the sender
          message: message?.trim() || null, // Store the message content if provided
          image_url: imageUrl || null, // Store uploaded image URL if present
          read_status: false, // Default read status
          is_edited: false, // Not edited initially
          created_at: new Date() // Timestamp for message creation
        }
      ]).select();
  
      if (messageInsert.error) {
        console.error('Message Insert Error:', messageInsert.error.message);
        return res.status(500).json({ error: 'Failed to save the message.' });
      }
      const messageData = messageInsert.data[0];
  
      // Step 4: Link the message to either an order or a conversation
      if (orderId) {
        const orderMessageInsert = await supabase.from('order_messages').insert([
          {
            order_id: parseInt(orderId, 10),
            message_id: messageData.id,
            linked_at: new Date() // Timestamp for linking
          }
        ]);
        if (orderMessageInsert.error) {
          console.error('Order Link Error:', orderMessageInsert.error.message);
          return res.status(500).json({ error: 'Failed to link the message to the order.' });
        }
      }
  
      if (conversation_id) {
        const conversationMessageInsert = await supabase.from('conversation_messages').insert([
          {
            conversation_id: parseInt(conversation_id, 10),
            message_id: messageData.id,
            added_at: new Date() // Timestamp for linking
          }
        ]);
        if (conversationMessageInsert.error) {
          console.error('Conversation Link Error:', conversationMessageInsert.error.message);
          return res.status(500).json({ error: 'Failed to link the message to the conversation.' });
        }
        // Update conversation's updated_at timestamp
        const conversationUpdate = await supabase.from('conversations')
          .update({ updated_at: new Date() })
          .eq('conversation_id', parseInt(conversation_id, 10));
        if (conversationUpdate.error) {
          console.error('Conversation Timestamp Update Error:', conversationUpdate.error.message);
          return res.status(500).json({ error: 'Failed to update the conversation timestamp.' });
        }
      }
  
      // Step 5: Emit the 'newMessage' event using Socket.IO
      const io = req.app.get('io');
      if (io) {
        if (orderId) {
          io.to(`order_${orderId}`).emit('newMessage', messageData);
        }
        if (conversation_id) {
          io.to(`conversation_${conversation_id}`).emit('newMessage', messageData);
        }
      }
  
      // Step 6: Return the success response with the message data.
      res.status(201).json({ message: 'Superuser message sent successfully!', messageData });
  
    } catch (err) {
      console.error('Unexpected Error in Superuser Message Sending:', err.message);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });    

// Get conversation id 
router.post('/conversation/id', async (req, res) => {
    const { user_id } = req.body; // Extract the user_id from the request body

    // Validate input
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required.' });
    }

    try {
        // Fetch the conversation associated with the given user ID
        const { data: conversation, error } = await supabase
            .from('conversations')
            .select('conversation_id') // Select only the conversation_id
            .eq('user_id', user_id) // Match the user_id
            .single(); // Expecting one conversation per user-superuser pair

        if (error || !conversation) {
            console.error('Conversation Fetch Error or Not Found:', error?.message);
            return res.status(404).json({ error: 'No conversation found for the provided user ID.' });
        }

        res.status(200).json({
            message: 'Conversation ID fetched successfully!',
            conversation_id: conversation.conversation_id,
        });
    } catch (err) {
        console.error('Unexpected Error in Fetching Conversation ID:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Conversations for a Superuser
router.post('/fetch/conversations', async (req, res) => {
    const { superuser_id } = req.body;

    try {
        // Step 1: Validate superuser
        const { data: superuserData, error: superuserError } = await supabase
            .from('superusers')
            .select('*')
            .eq('id', superuser_id)
            .single();

        if (superuserError || !superuserData) {
            console.error('Error Validating Superuser:', superuserError?.message);
            return res.status(403).json({ error: 'Superuser validation failed.' });
        }

        // Step 2: Fetch all conversations linked to the superuser
        const { data: conversations, error: conversationsError } = await supabase
           .from('conversations')
            .select('*, user_id (*), superuser_id (*)') // `user_id (*)` now works because the relationship is defined
           .eq('superuser_id', superuser_id) // Filter by superuser ID
           .order('updated_at', { ascending: false }); // Order by most recently updated


        if (conversationsError) {
            console.error('Error Fetching Conversations:', conversationsError.message);
            return res.status(500).json({ error: 'Failed to fetch conversations.' });
        }

        res.status(200).json({
            message: 'Conversations fetched successfully!',
            conversations,
        });
    } catch (err) {
        console.error('Unexpected Error in Fetching Conversations:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch conversation messages 
router.post('/fetch/conversation', async (req, res) => {
    const { conversation_id } = req.body;

    // Validate required input
    if (!conversation_id) {
        return res.status(400).json({ error: 'Conversation ID is required.' });
    }

    try {
        // Fetch all messages linked to the specified conversation
        const { data: messages, error } = await supabase
            .from('conversation_messages') // Use the bridge table
            .select(`
                message_id,
                messages(id, sender, message, image_url, created_at, updated_at, read_status, is_edited)
            `) // Fetch required fields explicitly from the `messages` table
            .eq('conversation_id', conversation_id) // Filter by conversation_id
            .order('created_at', { foreignTable: 'messages', ascending: true }); // Correctly order by the `created_at` column in `messages`

        if (error) {
            console.error('Error Fetching Messages for Conversation:', error.message);
            return res.status(500).json({ error: 'Failed to fetch messages for the conversation.' });
        }

        res.status(200).json({
            message: 'Messages for the conversation fetched successfully!',
            messages,
        });
    } catch (err) {
        console.error('Unexpected Error in Fetching Conversation Messages:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Messages for a Specific Order
router.post('/fetch/order', async (req, res) => {
    const { orderId } = req.body;

    // Validate required input
    if (!orderId) {
        return res.status(400).json({ error: 'Order ID is required.' });
    }

    try {
        // Fetch all messages linked to the specified order
        const { data: messages, error } = await supabase
            .from('order_messages') // Use the order_messages junction table
            .select(`
                message_id,
                messages(id, sender, message, image_url, created_at, updated_at, read_status, is_edited)
            `) // Fetch required fields explicitly from the `messages` table
            .eq('order_id', parseInt(orderId, 10)) // Filter by order ID
            .order('created_at', { foreignTable: 'messages', ascending: true }); // Specify 'messages' table for ordering

        if (error) {
            console.error('Error Fetching Messages for Order:', error.message);
            return res.status(500).json({ error: 'Failed to fetch messages for the order.' });
        }

        res.status(200).json({
            message: 'Messages for the order fetched successfully!',
            messages,
        });
    } catch (err) {
        console.error('Unexpected Error in Fetching Order Messages:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Endpoint to edit a message
// Endpoint to edit a message
router.patch('/edit', upload.single('image'), async (req, res) => {
  // Extract text fields from form-data (note: conversation_id is included if provided)
  const { messageId, sender_id, newMessage, conversation_id } = req.body;
  const imageFile = req.file; // New image upload (if provided)
  const removeImage = req.body.removeImage === 'true'; // Flag to remove the existing image

  // Validate required inputs
  if (!messageId || !sender_id || (!newMessage && !imageFile && !removeImage)) {
    return res.status(400).json({
      error: 'Message ID, sender ID, and either new content, an image, or removeImage flag are required.',
    });
  }

  try {
    // Step 1: Fetch the original message from the database
    const { data: originalMessage, error: fetchError } = await supabase
      .from('messages')
      .select('*')
      .eq('id', parseInt(messageId))
      .single();

    if (fetchError || !originalMessage) {
      console.error('Message Fetch Error:', fetchError?.message || 'Message not found.');
      return res.status(404).json({ error: 'Message not found.' });
    }

    // Verify that the sender_id in the request matches the sender in the original message
    if (originalMessage.sender !== sender_id) {
      return res.status(403).json({
        error: 'You are not allowed to edit this message.',
      });
    }

    // Step 2: Save edit history if the content or image is changed
    if ((newMessage && newMessage !== originalMessage.message) || imageFile || removeImage) {
      const { error: editHistoryError } = await supabase.from('edited_messages').insert([
        {
          original_message_id: messageId,
          old_message: originalMessage.message || null,
          new_message: newMessage || originalMessage.message,
          edited_by: sender_id,
          edited_at: new Date(),
        },
      ]);

      if (editHistoryError) {
        console.error('Edit History Insertion Error:', editHistoryError.message);
        return res.status(500).json({ error: 'Failed to save edit history.' });
      }
    }

    // Step 3: Process image upload or removal
    let newImageUrl = originalMessage.image_url; // Default to existing image URL

    if (imageFile) {
      try {
        console.log('Uploading new image...');
        newImageUrl = await uploadImageToSupabase(
          imageFile.buffer,
          `message_${Date.now()}_${imageFile.originalname}`
        );

        // Remove the old image if it exists
        if (originalMessage.image_url) {
          const oldFilePath = originalMessage.image_url.split('/storage/v1/object/public/images/')[1];
          const { error: deleteError } = await supabase.storage
            .from('images')
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
      const oldFilePath = originalMessage.image_url.split('/storage/v1/object/public/images/')[1];
      const { error: deleteError } = await supabase.storage
        .from('images')
        .remove([oldFilePath]);

      if (deleteError) {
        console.error('Image Removal Error:', deleteError.message);
        return res.status(500).json({ error: 'Failed to remove existing image.' });
      }
      newImageUrl = null;
    }

    // Step 4: Update the message in the database with the new content
    const { data: updatedMessage, error: updateError } = await supabase
      .from('messages')
      .update({
        message: newMessage || originalMessage.message,
        image_url: newImageUrl,
        updated_at: new Date(),
        is_edited: true,
      })
      .eq('id', parseInt(messageId))
      .select()
      .single();

    if (updateError) {
      console.error('Message Update Error:', updateError.message);
      return res.status(500).json({ error: 'Failed to update the message.' });
    }

    // Step 5: Fetch the related order ID (if applicable) from the order_messages table
    const { data: orderMsgLink, error: orderMsgLinkError } = await supabase
      .from('order_messages')
      .select('order_id')
      .eq('message_id', parseInt(messageId))
      .single();
    let orderId = null;
    if (!orderMsgLinkError && orderMsgLink) {
      orderId = orderMsgLink.order_id;
    }

    // Also fetch conversation_id from conversation_messages if not provided in body
    let convId = conversation_id;
    if (!convId) {
      const { data: convMsgLink, error: convMsgLinkError } = await supabase
        .from('conversation_messages')
        .select('conversation_id')
        .eq('message_id', parseInt(messageId))
        .single();
      if (!convMsgLinkError && convMsgLink) {
        convId = convMsgLink.conversation_id;
      }
    }

    // Step 6: Emit a socket event to notify connected clients of the edited message.
    const messageData = updatedMessage; // This is the updated message object.
    const io = req.app.get('io'); // Retrieve the Socket.IO instance.
    if (io) {
      if (orderId) {
        io.to(`order_${orderId}`).emit('messageEdited', messageData);
      }
      if (convId) {
        io.to(`conversation_${convId}`).emit('messageEdited', messageData);
      }
    }

    // Step 7: Return the updated message in the response.
    res.status(200).json({
      message: 'Message edited successfully!',
      updatedMessage: messageData,
    });
  } catch (err) {
    console.error('Unexpected Error in Edit Message:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});


// Endpoint to delete a message
router.delete('/delete', async (req, res) => {
  const { messageId } = req.body;
  
  // Validate input.
  if (!messageId) {
    return res.status(400).json({ error: 'Message ID is required.' });
  }

  try {
    // Step 1: Fetch the message from the database.
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('*')
      .eq('id', parseInt(messageId))
      .single();

    if (fetchError || !message) {
      console.error('Message Fetch Error:', fetchError?.message || 'Message not found.');
      return res.status(404).json({ error: 'Message not found.' });
    }

    // Step 2: Remove associated image (if it exists).
    if (message.image_url) {
      try {
        console.log('Deleting associated image...');
        const imagePath = message.image_url.split('/storage/v1/object/public/images/')[1];
        const { error: deleteImageError } = await supabase.storage
          .from('images')
          .remove([imagePath]);

        if (deleteImageError) {
          console.error('Image Deletion Error:', deleteImageError.message);
          return res.status(500).json({ error: 'Failed to delete associated image.' });
        }
      } catch (err) {
        console.error('Unexpected Image Deletion Error:', err.message);
        return res.status(500).json({ error: 'Error while deleting associated image.' });
      }
    }

    // Step 3: Retrieve linked order information (if the message is linked to an order).
    const { data: orderMsgLink, error: orderMsgLinkError } = await supabase
      .from('order_messages')
      .select('order_id')
      .eq('message_id', parseInt(messageId))
      .maybeSingle();
    let orderId = orderMsgLink ? orderMsgLink.order_id : null;
    if (orderMsgLinkError) {
      console.error('Error fetching order_messages link:', orderMsgLinkError.message);
    }

    // Step 4: Retrieve linked conversation information (if the message is part of a conversation).
    const { data: convMsgLink, error: convMsgLinkError } = await supabase
      .from('conversation_messages')
      .select('conversation_id')
      .eq('message_id', parseInt(messageId))
      .maybeSingle();
    let conversationId = convMsgLink ? convMsgLink.conversation_id : null;
    if (convMsgLinkError) {
      console.error('Error fetching conversation_messages link:', convMsgLinkError.message);
    }

    // Step 5: Archive deleted message info into deleted_messages table.
    // IMPORTANT:
    // If your deleted_messages table's foreign key on message_id is defined with ON DELETE CASCADE,
    // then deleting the original message will also delete the archived record.
    // To persist the deleted message info, adjust the foreign key settings accordingly.
    //
    // For debugging, log the data to be inserted.
    const archiveData = {
      message_id: message.id,
      sender: message.sender,
      message: message.message,
      image_url: message.image_url,
      created_at: message.created_at,
      order_id: orderId,
      conversation_id: conversationId,
      deleted_at: new Date().toISOString() // Explicit deletion timestamp.
    };
    console.log('Archiving deleted message:', archiveData);

    const { error: insertDeletedMessageError } = await supabase
      .from('deleted_messages')
      .insert(archiveData);

    if (insertDeletedMessageError) {
      console.error('Insert Deleted Message Error:', insertDeletedMessageError.message);
      return res.status(500).json({ error: 'Failed to store deleted message info.' });
    }

    // Step 6: Cleanup references in order_messages and conversation_messages.
    const { error: deleteOrderMessagesError } = await supabase
      .from('order_messages')
      .delete()
      .eq('message_id', parseInt(messageId));
    if (deleteOrderMessagesError) {
      console.error('Order Messages Deletion Error:', deleteOrderMessagesError.message);
      return res.status(500).json({ error: 'Failed to delete references in order_messages.' });
    }

    const { error: deleteConversationMessagesError } = await supabase
      .from('conversation_messages')
      .delete()
      .eq('message_id', parseInt(messageId));
    if (deleteConversationMessagesError) {
      console.error('Conversation Messages Deletion Error:', deleteConversationMessagesError.message);
      return res.status(500).json({ error: 'Failed to delete references in conversation_messages.' });
    }

    // Step 7: Delete the message itself.
    const { error: deleteMessageError } = await supabase
      .from('messages')
      .delete()
      .eq('id', parseInt(messageId));
    if (deleteMessageError) {
      console.error('Message Deletion Error:', deleteMessageError.message);
      return res.status(500).json({ error: 'Failed to delete the message.' });
    }

    // Step 8: Notify connected clients about the deletion.
    const payload = {
      messageId: parseInt(messageId),
      deleted: true,
      info: 'Message has been deleted and archived.'
    };
    const io = req.app.get('io');
    if (io) {
      if (orderId) {
        io.to(`order_${orderId}`).emit('messageDeleted', payload);
      }
      if (conversationId) {
        io.to(`conversation_${conversationId}`).emit('messageDeleted', payload);
      }
    }

    // Step 9: Return a success response.
    res.status(200).json({ message: 'Message deleted and archived successfully!' });
  } catch (err) {
    console.error('Unexpected Error in Deleting Message:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
