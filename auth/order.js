const express = require('express');
const { supabase } = require('../supabaseClient'); // Import Supabase client
const router = express.Router();
const multer = require('multer');
const nodemailer = require('nodemailer');
const sharp = require('sharp');

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 4 * 1024 * 1024 }, // Max 4 MB per file
});

// Helper Function: Sanitize File Name
const sanitizeFileName = (fileName) => {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_'); // Replace unsupported characters with underscores
};

// Helper Function: Compress and Upload Images to Supabase
const uploadImageToSupabase = async (buffer, fileName) => {
    try {
        console.log('Compressing image...');
        const compressedImage = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside' })
            .jpeg({ quality: 80 })
            .toBuffer();

        console.log('Sanitizing file name...');
        const sanitizedFileName = sanitizeFileName(fileName);
        const timestamp = Date.now();
        const filePath = `messages/${timestamp}-${sanitizedFileName}`;

        console.log('Uploading image to Supabase...');
        const { data, error } = await supabase.storage
            .from('images') // Ensure the bucket name is correct
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

// Helper Function: Send Order Details Email
const sendOrderDetailsEmail = async (email, order, items, userName, superuserName = 'Manager') => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_ADDRESS,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Parse delivery_address if it's a string
    let deliveryAddress = order.delivery_address;
    try {
        deliveryAddress = typeof order.delivery_address === 'string'
            ? JSON.parse(order.delivery_address)
            : order.delivery_address;
    } catch (error) {
        console.error('Error parsing delivery address JSON:', error.message);
        deliveryAddress = { address_line_1: 'Unknown', city: 'Unknown', state: 'Unknown', country: 'Unknown', postal_code: 'N/A', phone_number: 'N/A' };
    }

    // Calculate total order amount
    const totalOrderAmount = items.reduce((sum, item) => sum + (item.final_price || 0), 0);

    // Map items for display in the email
    const itemRows = items.map((item) => {
        // Format options column as "type_name: option_name"
        const options = item.options && item.options.length > 0
            ? item.options.map(opt => `${opt.type_name}: ${opt.option_name}`).join(', ')
            : 'Not Specified';

        return `
            <tr>
                <td style="border: 1px solid #ddd; padding: 10px;">${item.title}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">${options}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">${item.quantity}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">₹${item.final_price ? item.final_price.toFixed(2) : '0.00'}</td>
            </tr>
        `;
    }).join('');

    // Delivery or Pickup Details
    const deliveryDetails = order.delivery_type === "Delivery" && deliveryAddress
        ? `
            <h3 style="font-size: 16px; color: #333;">Delivery Address:</h3>
            <p><strong>${deliveryAddress.address_line_1 || 'Unknown'}</strong></p>
            ${deliveryAddress.address_line_2 ? `<p>${deliveryAddress.address_line_2}</p>` : ""}
            <p>${deliveryAddress.city || 'Unknown'}, ${deliveryAddress.state || 'Unknown'}, ${deliveryAddress.country || 'Unknown'} - ${deliveryAddress.postal_code || 'N/A'}</p>
            <p><strong>Phone:</strong> ${deliveryAddress.phone_number || 'N/A'}</p>
        `
        : `
            <h3 style="font-size: 16px; color: #333;">Pickup Information:</h3>
            <p>Your order is set for <strong>pickup</strong>. Please contact the manager for more details.</p>
        `;

    // Email Content
    const mailOptions = {
        from: process.env.EMAIL_ADDRESS,
        to: email,
        subject: `Your Order Details (#${order.id})`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333; padding: 30px; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px;">
                <h1 style="font-size: 24px; margin-bottom: 20px; color: #007bff;">Order Confirmation</h1>
                <p><strong>Order ID:</strong> ${order.id}</p>
                <p><strong>Placed By:</strong> ${userName}</p>
                <p><strong>Managed By:</strong> ${superuserName}</p>
                <p><strong>Status:</strong> ${order.order_status || 'Pending'}</p>
                <p><strong>Created At:</strong> ${order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A'}</p>
                
                ${deliveryDetails}
                
                <h2 style="font-size: 20px; margin-top: 20px; color: #333;">Order Items:</h2>
                <table style="border-collapse: collapse; width: 100%; margin: 20px auto; background-color: #fff; border: 1px solid #ddd; border-radius: 5px;">
                    <thead style="background-color: #007bff; color: #fff;">
                        <tr>
                            <th style="border: 1px solid #ddd; padding: 10px;">Product</th>
                            <th style="border: 1px solid #ddd; padding: 10px;">Options</th>
                            <th style="border: 1px solid #ddd; padding: 10px;">Quantity</th>
                            <th style="border: 1px solid #ddd; padding: 10px;">Total Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRows}
                    </tbody>
                </table>

                <p><strong>Total Order Amount:</strong> ₹${totalOrderAmount.toFixed(2)}</p>

                <p style="margin-top: 20px; font-size: 14px; color: #666;">Thank you for shopping with us! If you have questions, feel free to contact our support team.</p>
            </div>
        `,
    };

    // Send email
    try {
        await transporter.sendMail(mailOptions);
        console.log(`Order details email sent to ${email}`);
    } catch (err) {
        console.error(`Error sending email to ${email} (Order ID: ${order.id}):`, err.message);
        throw new Error('Failed to send order details email.');
    }
};

///------------------ Orders Endpoints ------------------///

// Create an Order
router.post('/create', async (req, res) => {
    const { user_id, items, delivery_type } = req.body;

    // Validate inputs
    if (!user_id || !items || items.length === 0) {
        return res.status(400).json({ error: 'User ID and at least one item are required to create an order.' });
    }

    if (!delivery_type || !['Pickup', 'Delivery'].includes(delivery_type)) {
        return res.status(400).json({ error: 'Delivery type must be either "Pickup" or "Delivery".' });
    }

    try {
        // Fetch user details
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('username, email')
            .eq('id', user_id)
            .single();

        if (userError || !userData) {
            console.error(`Error fetching user with ID ${user_id}:`, userError?.message || 'User not found.');
            return res.status(404).json({ error: 'User not found.' });
        }

        const { username, email } = userData;

        let deliveryAddress = null;

        // Handle "Delivery" type orders
        if (delivery_type === 'Delivery') {
            const { data: userInfo, error: userInfoError } = await supabase
                .from('info')
                .select('phone_number, address_line_1, address_line_2, city, state, country, postal_code')
                .eq('user_id', user_id)
                .single();

            if (userInfoError || !userInfo) {
                return res.status(400).json({ error: 'No saved address found. Please save an address first.' });
            }

            deliveryAddress = userInfo;
        }

        // Fetch superuser details (ID, username, email)
        const { data: superuserData, error: superuserError } = await supabase
            .from('superusers')
            .select('id, username, email')
            .limit(1)
            .single();

        if (superuserError || !superuserData) {
            return res.status(500).json({ error: 'Failed to retrieve manager information.' });
        }

        const superuser_id = superuserData.id;
        const superuser_email = superuserData.email;
        const superuser_name = superuserData.username || 'Manager'; // Default to "Manager" if the name is unavailable

        // Create the order
        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .insert([{
                user_id,
                order_status: 'Pending',
                created_at: new Date().toISOString(),
                delivery_type,
                delivery_address: deliveryAddress ? JSON.stringify(deliveryAddress) : null,
            }])
            .select()
            .single();

        if (orderError) {
            console.error('Error creating order:', orderError.message);
            return res.status(500).json({ error: 'Failed to create the order.' });
        }

        const orderId = orderData.id;

        // Process items and fetch their details
        const detailedItems = await Promise.all(items.map(async (item) => {
            const { data: product, error: productError } = await supabase
                .from('products')
                .select(`
                    id, title, price, images, 
                    options:product_options (
                        option_id
                    )
                `)
                .eq('id', item.product_id)
                .single();

            if (productError || !product) {
                throw new Error(`Product with ID ${item.product_id} not found.`);
            }

            // Check if the product has associated options
            const validOptionIds = product.options?.map(option => option.option_id) || [];
            const hasOptions = validOptionIds.length > 0;

            let finalPrice;

            // Calculate price based on whether the product has types or not
            if (hasOptions && Array.isArray(item.option_ids) && item.option_ids.length > 0) {
                const { data: comboData, error: comboError } = await supabase
                    .from('types_combo')
                    .select('combo_price')
                    .eq('product_id', item.product_id)
                    .eq('options', `{${item.option_ids.join(',')}}`)
                    .single();

                if (comboError || !comboData) {
                    throw new Error(`The combo selected for product ID ${item.product_id} is not available.`);
                }

                finalPrice = comboData.combo_price * item.quantity;
            } else {
                finalPrice = product.price * item.quantity;
            }

            // Map type_name to each option if applicable
            const optionsWithTypes = hasOptions
                ? await Promise.all(item.option_ids.map(async (optionId) => {
                    const { data: optionData, error: optionError } = await supabase
                        .from('options')
                        .select('id, option_name, type_id')
                        .eq('id', optionId)
                        .single();

                    if (optionError || !optionData) {
                        throw new Error(`Failed to fetch option details for option ID ${optionId}.`);
                    }

                    const { data: typeData, error: typeError } = await supabase
                        .from('types')
                        .select('type_name')
                        .eq('id', optionData.type_id)
                        .single();

                    if (typeError || !typeData) {
                        throw new Error(`Failed to fetch type name for type ID ${optionData.type_id}.`);
                    }

                    return {
                        id: optionData.id,
                        option_name: optionData.option_name,
                        type_id: optionData.type_id,
                        type_name: typeData.type_name,
                    };
                }))
                : [];

            return {
                order_id: orderId,
                product_id: item.product_id,
                title: product.title,
                price: product.price,
                final_price: finalPrice,
                images: product.images,
                options: optionsWithTypes,
                quantity: item.quantity,
            };
        }));

        // Insert order items
        const orderItems = detailedItems.map(item => ({
            order_id: item.order_id,
            product_id: item.product_id,
            price: item.final_price,
            quantity: item.quantity,
        }));

        const { data: insertedItems, error: orderItemsError } = await supabase
            .from('orderitems')
            .insert(orderItems)
            .select();

        if (orderItemsError) {
            return res.status(500).json({ error: 'Failed to add items to the order.' });
        }

        // Insert associated options into `order_item_options` if applicable
        const orderItemOptions = insertedItems.flatMap(orderItem => {
            const relatedItem = detailedItems.find(item => item.product_id === orderItem.product_id);
            return relatedItem.options.map(option => ({
                order_item_id: orderItem.id,
                option_id: option.id,
            }));
        });

        if (orderItemOptions.length > 0) {
            const { error: optionsError } = await supabase
                .from('order_item_options')
                .insert(orderItemOptions);

            if (optionsError) {
                console.error('Error adding options to the order items:', optionsError.message);
                return res.status(500).json({ error: 'Failed to add options to the order.' });
            }
        }

        // Notify user and superuser
        await supabase.from('messages').insert([{
            order_id: orderId,
            sender: superuser_id,
            message: `Your order has been placed successfully! Order ID: ${orderId}. Thank you for shopping with us.`,
            read_status: false,
            created_at: new Date().toISOString(),
        }]);

        // Send email to the superuser
        await sendOrderDetailsEmail(superuser_email, orderData, detailedItems, username, superuser_name);

        res.status(201).json({
            message: 'Order created successfully!',
            order: orderData,
            items: detailedItems,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// Cancel Order Items
router.post('/cancel', async (req, res) => {
    const { order_id, user_id, cancel_items } = req.body; // Extract data from request body

    // Validate inputs
    if (!order_id || !user_id || !Array.isArray(cancel_items) || cancel_items.length === 0) {
        return res.status(400).json({ error: 'Order ID, User ID, and items to cancel are required.' });
    }

    try {
        // Check if the order belongs to the user
        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .select('user_id, order_status')
            .eq('id', order_id)
            .single();

        if (orderError || !orderData) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        if (orderData.user_id !== user_id) {
            return res.status(403).json({ error: 'You are not authorized to cancel this order.' });
        }

        if (orderData.order_status === 'Cancelled') {
            return res.status(400).json({ error: 'This order has already been cancelled.' });
        }

        // Fetch order items to validate cancellation
        const { data: orderItems, error: itemsError } = await supabase
            .from('orderitems')
            .select('*')
            .eq('order_id', order_id);

        if (itemsError || !orderItems || orderItems.length === 0) {
            return res.status(404).json({ error: 'Order items not found.' });
        }

        // Validate cancel_items against existing order items
        const validCancelItems = cancel_items.filter(cancelItem => {
            return orderItems.some(orderItem => orderItem.product_id === cancelItem.product_id);
        });

        if (validCancelItems.length === 0) {
            return res.status(400).json({ error: 'No valid items found for cancellation.' });
        }

        // Delete associated options for cancelled items
        const cancelledItemIds = orderItems
            .filter(orderItem => validCancelItems.some(cancelItem => cancelItem.product_id === orderItem.product_id))
            .map(item => item.id); // Collect order item IDs

        const { error: deleteOptionsError } = await supabase
            .from('order_item_options')
            .delete()
            .in('order_item_id', cancelledItemIds);

        if (deleteOptionsError) {
            console.error('Error deleting options for cancelled items:', deleteOptionsError.message);
            return res.status(500).json({ error: 'Failed to delete options for the cancelled items.' });
        }

        // Delete cancelled items from the `orderitems` table
        const { error: deleteItemsError } = await supabase
            .from('orderitems')
            .delete()
            .eq('order_id', order_id)
            .in('product_id', validCancelItems.map(item => item.product_id));

        if (deleteItemsError) {
            console.error('Error cancelling items from order:', deleteItemsError.message);
            return res.status(500).json({ error: 'Failed to cancel items from the order.' });
        }

        // Update order status if no items left
        const remainingItems = orderItems.filter(orderItem => !validCancelItems.some(cancelItem => cancelItem.product_id === orderItem.product_id));

        if (remainingItems.length === 0) {
            const { error: updateStatusError } = await supabase
                .from('orders')
                .update({ order_status: 'Cancelled' })
                .eq('id', order_id);

            if (updateStatusError) {
                return res.status(500).json({ error: 'Failed to update order status.' });
            }
        }

        // Respond with success
        res.status(200).json({
            message: 'Items successfully cancelled from the order!',
            cancelled_items: validCancelItems,
            remaining_items: remainingItems,
        });
    } catch (err) {
        console.error('Unexpected error during order cancellation:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Update Order Status (and notify user)
router.put('/status', async (req, res) => {
    const { order_id, status, superuser_id } = req.body; // Added `superuser_id` for validation

    // Validate input
    if (!order_id) {
        return res.status(400).json({ error: 'Order ID is required.' });
    }
    if (!status) {
        return res.status(400).json({ error: 'Order status is required.' });
    }

    try {
        // Validate if superuser exists
        if (superuser_id) {
            const { data: superuser, error: superuserError } = await supabase
                .from('superusers')
                .select('id')
                .eq('id', superuser_id)
                .single();

            if (superuserError || !superuser) {
                return res.status(403).json({ error: 'Unauthorized: Invalid superuser ID.' });
            }
        }

        // Update the order status
        const { data: updatedOrder, error } = await supabase
            .from('orders')
            .update({ order_status: status })
            .eq('id', order_id)
            .select()
            .single(); // Retrieve the updated order

        if (error) {
            console.error('Error updating order status:', error.message);
            return res.status(500).json({ error: 'Failed to update order status.' });
        }

        if (!updatedOrder) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        // Insert a message into the `messages` table
        try {
            const { error: messageError } = await supabase
                .from('messages')
                .insert([{
                    order_id: order_id,
                    sender: superuser_id ? superuser_id : 'System', // Superuser ID or System
                    message: `Your order status has been updated to '${status}'.`,
                    read_status: false,
                    created_at: new Date().toISOString(),
                }]);

            if (messageError) {
                console.error('Error sending update message:', messageError.message);
            }
        } catch (err) {
            console.error('Unexpected error inserting message:', err.message);
        }

        res.status(200).json({
            message: `Order status updated to '${status}' successfully, and user notified!`,
            order: updatedOrder,
        });
    } catch (err) {
        console.error('Unexpected error updating order status:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch Orders for a Specific User
// Fetch Orders for a Specific User
router.post('/user/orders', async (req, res) => {
    const { user_id } = req.body;

    // Validate input
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required to fetch orders.' });
    }

    try {
        // Fetch orders for the specific user along with related data
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select(`
                id,
                user_id,
                order_status,
                delivery_type,
                delivery_address,
                created_at,
                orderitems (
                    id,
                    product_id,
                    quantity,
                    price,
                    products (
                        id,
                        title,
                        description,
                        images
                    ),
                    order_item_options (
                        option_id,
                        options (
                            option_name,
                            type_id,
                            types (
                                type_name
                            )
                        )
                    )
                )
            `)
            .eq('user_id', user_id)
            .order('created_at', { ascending: false });

        if (ordersError) {
            console.error('Error fetching user orders:', ordersError.message);
            return res.status(500).json({ error: 'Failed to fetch user orders.' });
        }

        if (!orders || orders.length === 0) {
            return res.status(404).json({ error: 'No orders found for the given user.' });
        }

        // Process orders
        const processedOrders = orders.map((order) => {
            // Parse delivery address if it exists
            let deliveryAddress = null;
            if (order.delivery_type === 'Delivery' && order.delivery_address) {
                try {
                    deliveryAddress = JSON.parse(order.delivery_address);
                } catch (err) {
                    console.error('Failed to parse delivery address JSON:', err.message);
                    deliveryAddress = null;
                }
            }

            // Format order items
            const formattedItems = order.orderitems.map((item) => ({
                order_item_id: item.id,
                product_id: item.product_id,
                title: item.products?.title || 'N/A',
                description: item.products?.description || 'N/A',
                price: item.price,
                images: item.products?.images || [],
                options: item.order_item_options.map((option) => ({
                    id: option.option_id,
                    name: option.options.option_name,
                    type_id: option.options.type_id,
                    type_name: option.options.types.type_name,
                })),
                quantity: item.quantity,
            }));

            return {
                order_id: order.id,
                status: order.order_status,
                created_at: order.created_at,
                delivery_type: order.delivery_type,
                delivery_address: deliveryAddress,
                items: formattedItems,
            };
        });

        res.status(200).json({
            message: 'User orders fetched successfully!',
            orders: processedOrders,
        });
    } catch (err) {
        console.error('Unexpected error while fetching user orders:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});
// Fetch All Orders
router.get('/all', async (req, res) => {
    try {
        // Fetch all orders with related data
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select(`
                id,
                user_id,
                order_status,
                delivery_type,
                delivery_address,
                created_at,
                orderitems (
                    id,
                    product_id,
                    quantity,
                    price, -- Fetch the actual price (final_price) from the orderitems table
                    products (
                        id,
                        title,
                        description,
                        images
                    ),
                    order_item_options (
                        option_id,
                        options (
                            option_name,
                            type_id,
                            types (
                                type_name
                            )
                        )
                    )
                )
            `)
            .order('created_at', { ascending: false }); // Sort by the most recent orders

        if (ordersError) {
            console.error('Error fetching all orders:', ordersError.message);
            return res.status(500).json({ error: 'Failed to fetch all orders.' });
        }

        if (!orders || orders.length === 0) {
            return res.status(404).json({ error: 'No orders found in the database.' });
        }

        // Process each order to structure delivery details and item-related information
        const processedOrders = orders.map(order => {
            // Parse delivery address if it exists
            let deliveryAddress = null;
            if (order.delivery_type === "Delivery" && order.delivery_address) {
                try {
                    deliveryAddress = JSON.parse(order.delivery_address);
                } catch (err) {
                    console.error('Failed to parse delivery address JSON:', err.message);
                    deliveryAddress = null; // Default to null if parsing fails
                }
            }

            // Format each order's items
            const formattedItems = order.orderitems.map(item => ({
                order_item_id: item.id, // Rename in response
                product_id: item.product_id,
                title: item.products.title,
                description: item.products.description,
                price: item.price, // Use the price from the orderitems table
                images: item.products.images,
                options: item.order_item_options.map(option => ({
                    id: option.option_id,
                    name: option.options.option_name,
                    type_id: option.options.type_id,
                    type_name: option.options.types.type_name,
                })),
                quantity: item.quantity,
            }));

            return {
                order_id: order.id, // Rename in response
                user_id: order.user_id,
                status: order.order_status,
                delivery_type: order.delivery_type,
                delivery_address: deliveryAddress,
                created_at: order.created_at,
                items: formattedItems,
            };
        });

        res.status(200).json({
            message: 'Orders fetched successfully!',
            orders: processedOrders,
        });
    } catch (err) {
        console.error('Unexpected error while fetching all orders:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

/// ------------------ Messages Endpoints ------------------ ///

// Send a Message (User or Superuser)
router.post('/messages/send', upload.single('image'), async (req, res) => {
    const { orderId, sender_id, message } = req.body;
    const imageFile = req.file;

    // Validate input
    if (!orderId || !sender_id || (!message && !imageFile)) {
        return res.status(400).json({ error: 'Order ID, sender ID, and either a message or an image are required.' });
    }

    try {
        let imageUrl = null;

        // If an image is provided, upload it to Supabase
        if (imageFile) {
            try {
                imageUrl = await uploadImageToSupabase(imageFile.buffer, `message_${Date.now()}_${imageFile.originalname}`);
            } catch (err) {
                console.error('Error uploading image:', err.message);
                return res.status(500).json({ error: 'Failed to upload image.' });
            }
        }

        // Insert the message into the `messages` table
        const { data, error } = await supabase
            .from('messages')
            .insert([{
                order_id: parseInt(orderId), // Link message to the specific order
                sender: sender_id, // Use sender_id directly
                message: message || null, // Optional text message
                image_url: imageUrl || null, // Optional image URL
            }])
            .select(); // Return the inserted message

        if (error) {
            console.error('Error sending message:', error.message);
            return res.status(500).json({ error: 'Failed to send the message.' });
        }

        res.status(201).json({ message: 'Message sent successfully!', messageData: data });
    } catch (err) {
        console.error('Unexpected error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Fetch All Messages for a Specific Order
router.post('/messages/fetch', async (req, res) => {
    const { order_id } = req.body;

    if (!order_id) {
        return res.status(400).json({ error: 'Order ID is required.' });
    }

    try {
        const { data, error } = await supabase
            .from('messages')
            .select('sender, message, image_url, read_status, created_at')
            .eq('order_id', parseInt(order_id))
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching messages:', error.message);
            return res.status(500).json({ error: 'Failed to fetch messages.' });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'No messages found for this order.' });
        }

        res.status(200).json({
            message: 'Messages fetched successfully!',
            messages: data
        });
    } catch (err) {
        console.error('Unexpected error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
