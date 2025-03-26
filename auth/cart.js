const express = require('express');
const { supabase } = require('../supabaseClient');
const router = express.Router();
const nodemailer = require('nodemailer');

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
    if (typeof order.delivery_address === 'string') {
        try {
            deliveryAddress = JSON.parse(order.delivery_address);
        } catch (error) {
            console.error('Error parsing delivery address JSON:', error.message);
            deliveryAddress = null; // Default to null if parsing fails
        }
    }

    // Map items for display in the email
    const itemRows = items.map((item) => {
        const options = item.options && item.options.length > 0
            ? item.options.map(opt => `${opt.type_name}: ${opt.name}`).join(', ')
            : 'N/A';

        return `
            <tr>
                <td style="border: 1px solid #ddd; padding: 10px;">${item.title}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">${options}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">${item.quantity}</td>
                <td style="border: 1px solid #ddd; padding: 10px;">₹${(item.price * item.quantity).toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    // Delivery or Pickup Details
    const deliveryDetails = order.delivery_type === "Delivery" && deliveryAddress
        ? `
            <h3 style="font-size: 16px; color: #333;">Delivery Address:</h3>
            <p><strong>${deliveryAddress.address_line_1}</strong></p>
            ${deliveryAddress.address_line_2 ? `<p>${deliveryAddress.address_line_2}</p>` : ""}
            <p>${deliveryAddress.city}, ${deliveryAddress.state}, ${deliveryAddress.country} - ${deliveryAddress.postal_code}</p>
            <p><strong>Phone:</strong> ${deliveryAddress.phone_number}</p>
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
                <p><strong>Status:</strong> ${order.order_status}</p>
                <p><strong>Created At:</strong> ${new Date(order.created_at).toLocaleString()}</p>
                
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

                <p style="margin-top: 20px; font-size: 14px; color: #666;">Thank you for shopping with us! If you have questions, feel free to contact our support team.</p>
            </div>
        `,
    };

    // Send email
    try {
        await transporter.sendMail(mailOptions);
        console.log(`Order details email sent to ${email}`);
    } catch (err) {
        console.error('Error sending order details email:', err.message);
        throw new Error('Failed to send order details email.');
    }
};

// Add Product to Cart
router.post('/add', async (req, res) => {
    const { user_id, product_id, option_ids, quantity } = req.body;

    try {
        // Validate input
        if (!user_id || !product_id || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'User ID, Product ID, and valid quantity are required.' });
        }

        // Fetch product details along with its valid options
        const { data: product, error: productError } = await supabase
            .from('products')
            .select(`
                id,
                options:product_options (
                    option_id
                )
            `)
            .eq('id', product_id)
            .single();

        if (productError || !product) {
            console.error(`Error fetching product with ID ${product_id}:`, productError?.message || 'Product not found.');
            return res.status(404).json({ error: 'Product not found.' });
        }

        // Check if the product has associated options
        const validOptionIds = product.options.map(option => option.option_id);
        const hasOptions = validOptionIds.length > 0;

        // Make options mandatory if the product has associated options
        if (hasOptions) {
            if (!Array.isArray(option_ids) || option_ids.length === 0) {
                return res.status(400).json({ error: 'Option IDs are mandatory for this product and cannot be empty.' });
            }

            const areOptionsValid = option_ids.every(optionId => validOptionIds.includes(optionId));
            if (!areOptionsValid) {
                return res.status(400).json({ error: 'One or more selected options are invalid for this product.' });
            }
        }

        // Insert product into the cart
        const { data: cartItem, error: cartInsertError } = await supabase
            .from('cart')
            .insert([{ user_id, product_id, quantity }])
            .select()
            .single();

        if (cartInsertError || !cartItem) {
            console.error('Error adding product to cart:', cartInsertError?.message);
            return res.status(500).json({ error: 'Failed to add product to cart.' });
        }

        const cartItemId = cartItem.id;

        // Insert options into the cart_item_options table (if applicable)
        if (hasOptions) {
            const cartItemOptions = option_ids.map(optionId => ({
                cart_item_id: cartItemId,
                option_id: optionId
            }));

            const { error: cartOptionsError } = await supabase
                .from('cart_item_options')
                .insert(cartItemOptions);

            if (cartOptionsError) {
                console.error('Error adding options for the cart item:', cartOptionsError?.message);
                return res.status(500).json({ error: 'Failed to add options for the cart item.' });
            }
        }

        // Respond with success
        res.status(201).json({
            message: 'Product successfully added to cart!',
            cart_item: cartItem,
            options: hasOptions ? option_ids : []
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});


// Fetch Cart Items
router.post('/fetch', async (req, res) => {
    const { user_id } = req.body;

    try {
        // Validate input
        if (!user_id) {
            return res.status(400).json({ error: 'User ID is required to fetch cart items.' });
        }

        // Fetch cart items for the user
        const { data: cartItems, error: cartError } = await supabase
            .from('cart')
            .select(`
                id,
                product_id,
                quantity,
                created_at,
                updated_at,
                products (
                    id,
                    title,
                    description,
                    price,
                    images,
                    stock_quantity
                ),
                cart_item_options (
                    option_id,
                    options(option_name, type_id, types(type_name))
                )
            `)
            .eq('user_id', user_id);

        if (cartError) {
            console.error('Error fetching cart items:', cartError.message);
            return res.status(500).json({ error: 'Failed to fetch cart items.' });
        }

        // Format the response for better readability
        const formattedCartItems = cartItems.map(cartItem => ({
            cart_id: cartItem.id,
            product_id: cartItem.product_id,
            product: {
                id: cartItem.products.id,
                title: cartItem.products.title,
                description: cartItem.products.description,
                price: cartItem.products.price,
                images: cartItem.products.images,
                stock_quantity: cartItem.products.stock_quantity
            },
            options: cartItem.cart_item_options.map(option => ({
                id: option.option_id,
                name: option.options.option_name,
                type_id: option.options.type_id,
                type_name: option.options.types.type_name,
            })),
            quantity: cartItem.quantity,
            created_at: cartItem.created_at,
            updated_at: cartItem.updated_at
        }));

        // Respond with the formatted cart items
        res.status(200).json({
            message: 'Cart items fetched successfully!',
            cart_items: formattedCartItems
        });
    } catch (err) {
        console.error('Unexpected error while fetching cart items:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Delete Product from Cart
router.delete('/delete', async (req, res) => {
    const { user_id, cart_item_id } = req.body;

    try {
        // Validate input
        if (!user_id || !cart_item_id) {
            return res.status(400).json({ error: 'User ID and Cart Item ID are required to delete a product from the cart.' });
        }

        // Check if the cart item exists before attempting to delete
        const { data: existingItem, error: fetchError } = await supabase
            .from('cart')
            .select('*')
            .eq('id', cart_item_id)
            .eq('user_id', user_id)
            .single();

        if (fetchError || !existingItem) {
            return res.status(404).json({ error: 'Cart item not found.' });
        }

        // Delete associated options from cart_item_options table
        const { error: deleteOptionsError } = await supabase
            .from('cart_item_options')
            .delete()
            .eq('cart_item_id', cart_item_id);

        if (deleteOptionsError) {
            console.error('Error deleting options for cart item:', deleteOptionsError.message);
            return res.status(500).json({ error: 'Failed to delete associated options.' });
        }

        // Delete the product from the cart
        const { error: deleteItemError } = await supabase
            .from('cart')
            .delete()
            .eq('id', cart_item_id)
            .eq('user_id', user_id);

        if (deleteItemError) {
            console.error('Error deleting product from cart:', deleteItemError.message);
            return res.status(500).json({ error: 'Failed to delete product from cart.' });
        }

        res.status(200).json({
            message: 'Product and associated options removed from cart successfully!',
            deleted_item: existingItem // Return the previously fetched item as confirmation
        });
    } catch (err) {
        console.error('Unexpected error while deleting from cart:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Place Order from Cart
router.post('/place/order', async (req, res) => {
    const { user_id, delivery_type } = req.body;

    // Validate input
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required to place an order.' });
    }

    if (!delivery_type || !['Pickup', 'Delivery'].includes(delivery_type)) {
        return res.status(400).json({ error: 'Delivery type must be either "Pickup" or "Delivery".' });
    }

    try {
        // Fetch cart items with associated options
        const { data: cartItems, error: cartError } = await supabase
            .from('cart')
            .select(`
                id,
                product_id,
                quantity,
                cart_item_options (
                    option_id,
                    options(option_name, type_id, types(type_name))
                ),
                products (
                    id,
                    title,
                    price,
                    images
                )
            `)
            .eq('user_id', user_id);

        if (cartError || !cartItems || cartItems.length === 0) {
            return res.status(400).json({ error: 'No items in the cart to place an order.' });
        }

        console.log('Cart Items:', cartItems);

        // Handle delivery type and address
        let deliveryAddress = null;
        if (delivery_type === 'Delivery') {
            const { data: userInfo, error: userInfoError } = await supabase
                .from('info')
                .select('phone_number, address_line_1, address_line_2, city, state, country, postal_code')
                .eq('user_id', user_id)
                .single();

            if (userInfoError || !userInfo) {
                console.error('No address found for this user:', userInfoError?.message);
                return res.status(400).json({ error: 'No saved address found. Please save an address first.' });
            }
            deliveryAddress = userInfo;
        }

        // Fetch superuser ID
        const { data: superuserData, error: superuserError } = await supabase
            .from('superusers')
            .select('id')
            .limit(1)
            .single();

        if (superuserError || !superuserData) {
            console.error('Failed to fetch superuser ID:', superuserError?.message);
            return res.status(500).json({ error: 'Failed to retrieve manager information.' });
        }

        const superuser_id = superuserData.id;

        // Create a new order
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

        // Map and insert order items into `orderitems`
        const detailedItems = cartItems.map(cartItem => ({
            order_id: orderId,
            product_id: cartItem.product_id,
            title: cartItem.products.title,
            price: cartItem.products.price,
            images: cartItem.products.images,
            options: cartItem.cart_item_options?.map(option => ({
                id: option.option_id,
                name: option.options.option_name,
                type_id: option.options.type_id,
                type_name: option.options.types.type_name,
            })) || [],
            quantity: cartItem.quantity,
        }));

        const orderItems = detailedItems.map(item => ({
            order_id: item.order_id,
            product_id: item.product_id,
            price: item.price,
            quantity: item.quantity,
        }));

        const { data: insertedOrderItems, error: orderItemsError } = await supabase
            .from('orderitems')
            .insert(orderItems)
            .select();

        if (orderItemsError) {
            console.error('Error adding items to the order:', orderItemsError.message);
            return res.status(500).json({ error: 'Failed to add items to the order.' });
        }

        // Map and insert associated options into `order_item_options`
        const orderItemOptions = [];
        insertedOrderItems.forEach(orderItem => {
            const cartItem = cartItems.find(item => item.product_id === orderItem.product_id);
            if (cartItem && cartItem.cart_item_options) {
                cartItem.cart_item_options.forEach(option => {
                    orderItemOptions.push({
                        order_item_id: orderItem.id,
                        option_id: option.option_id,
                    });
                });
            }
        });

        if (orderItemOptions.length > 0) {
            const { error: orderOptionsError } = await supabase
                .from('order_item_options')
                .insert(orderItemOptions);

            if (orderOptionsError) {
                console.error('Error adding options to the order items:', orderOptionsError.message);
                return res.status(500).json({ error: 'Failed to add options to the order.' });
            }
        }

        console.log('Order Items with Options:', orderItemOptions);

        // Clear the user's cart after order placement
        const { error: clearCartError } = await supabase
            .from('cart')
            .delete()
            .eq('user_id', user_id);

        if (clearCartError) {
            console.error('Error clearing cart:', clearCartError.message);
            return res.status(500).json({ error: 'Failed to clear the cart.' });
        }

        // Notify user of order placement and send email
        const { data: user } = await supabase
            .from('users')
            .select('username, email')
            .eq('id', user_id)
            .single();

        await supabase
            .from('messages')
            .insert([{
                order_id: orderId,
                sender: superuser_id,
                message: `Your order has been placed successfully! Order ID: ${orderId}. Thank you for shopping with us.`,
                read_status: false,
                created_at: new Date().toISOString(),
            }]);

        await sendOrderDetailsEmail(
            user.email,
            { ...orderData, delivery_address: deliveryAddress },
            detailedItems,
            user.username
        );

        res.status(201).json({
            message: 'Order placed successfully!',
            order: orderData,
            order_items: detailedItems,
        });
    } catch (err) {
        console.error('Unexpected error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
