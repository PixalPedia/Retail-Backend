const express = require('express');
const { supabase } = require('../supabaseClient');
const router = express.Router();
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');

// Helper Function: Check if a user is a superuser
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

// POST /report 
// For a yearly report (value: "2024") or monthly report (value: "May 2024")
// The payload must include "period", "value", and the "user_id" (of the superuser)
router.post('/report', async (req, res) => {
  const { period, value, user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'UserID is required.' });
  }
  // Validate superuser privileges
  const isSuper = await isSuperUser(user_id);
  if (!isSuper) {
    return res.status(403).json({ error: 'Only superusers can generate reports.' });
  }

  if (!period || !value) {
    return res.status(400).json({ error: 'Both period and value are required.' });
  }

  let startDate, endDate;
  if (period === "year") {
    startDate = `${value}-01-01`;
    endDate = `${value}-12-31`;
  } else if (period === "month") {
    // Expecting format "May 2024"
    const parts = value.split(" ");
    if (parts.length !== 2) {
      return res.status(400).json({ error: "Invalid month format. Please use 'Month YYYY' (e.g., 'May 2024')." });
    }
    const [monthName, year] = parts;
    const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth() + 1;
    if (isNaN(monthIndex)) {
      return res.status(400).json({ error: 'Invalid month name or year.' });
    }
    const start = new Date(year, monthIndex - 1, 1);
    const end = new Date(year, monthIndex, 0);
    startDate = start.toISOString().split('T')[0];
    endDate = end.toISOString().split('T')[0];
  } else {
    return res.status(400).json({ error: 'Invalid period specified; use "year" or "month".' });
  }

  // ----------------
  // Fetch orders in the specified period
  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .gte('created_at', startDate)
    .lte('created_at', endDate);
    
  if (orderError) {
    console.error('Error fetching orders:', orderError.message);
    return res.status(500).json({ error: 'Error fetching orders.' });
  }
  if (!orders || orders.length === 0) {
    return res.status(404).json({ error: "No orders found for the specified period." });
  }

  // ----------------
  // Aggregate metrics
  const totalOrders = orders.length;
  const orderIds = orders.map(order => order.id);

  // Fetch order items for these orders
  const { data: orderItems, error: orderItemsError } = await supabase
    .from('orderitems')
    .select('*')
    .in('order_id', orderIds);

  if (orderItemsError) {
    console.error('Error fetching order items:', orderItemsError.message);
    return res.status(500).json({ error: 'Failed to fetch order items.' });
  }

  // Total Earnings: Sum (price * quantity) for each order item
  const totalEarnings = orderItems.reduce((sum, item) => {
    return sum + (parseFloat(item.price) * item.quantity);
  }, 0);

  // Most Ordered Product
  const productCounts = {};
  orderItems.forEach(item => {
    productCounts[item.product_id] = (productCounts[item.product_id] || 0) + item.quantity;
  });
  const mostOrderedProductId = Object.keys(productCounts).reduce((a, b) =>
    productCounts[a] > productCounts[b] ? a : b
  );
  let mostOrderedProductName = 'N/A';
  if (mostOrderedProductId) {
    const { data: productData, error: productError } = await supabase
      .from('products')
      .select('title')
      .eq('id', mostOrderedProductId)
      .single();
    if (!productError && productData) {
      mostOrderedProductName = productData.title;
    }
  }

  // Most Liked Category (via Reviews)
  const { data: reviews, error: reviewError } = await supabase
    .from('reviews')
    .select('*')
    .gte('created_at', startDate)
    .lte('created_at', endDate);
  
  let mostLikedCategoryName = 'N/A';
  if (!reviewError && reviews && reviews.length > 0) {
    const reviewProductIds = reviews.map(review => review.product_id);
    const { data: productCategories, error: pcError } = await supabase
      .from('product_categories')
      .select('*')
      .in('product_id', reviewProductIds);
    if (!pcError && productCategories && productCategories.length > 0) {
      // Count reviews per category (if a product belongs to multiple categories, counted in each)
      const categoryReviewCounts = {};
      productCategories.forEach(pc => {
        if (reviewProductIds.includes(pc.product_id)) {
          categoryReviewCounts[pc.category_id] = (categoryReviewCounts[pc.category_id] || 0) + 1;
        }
      });
      const mostLikedCategoryId = Object.keys(categoryReviewCounts).reduce((a, b) =>
        categoryReviewCounts[a] > categoryReviewCounts[b] ? a : b
      );
      if (mostLikedCategoryId) {
        const { data: categoriesData, error: catError } = await supabase
          .from('categories')
          .select('name')
          .eq('id', mostLikedCategoryId)
          .single();
        if (!catError && categoriesData) {
          mostLikedCategoryName = categoriesData.name;
        }
      }
    }
  }

  // ----------------
  // Prepare additional data for Detailed Report

  // MAP USERS: get usernames based on order user_ids
  const uniqueUserIds = Array.from(new Set(orders.map(order => order.user_id)));
  const { data: usersData, error: usersError } = await supabase
    .from('users')
    .select('id, username')
    .in('id', uniqueUserIds);
    
  const userMap = {};
  if (!usersError && Array.isArray(usersData)) {
    usersData.forEach(user => {
      userMap[user.id] = user.username;
    });
  } else {
    console.error('Error fetching user data:', usersError);
  }

  // MAP PRODUCTS: get product titles from order items (for product names)
  const uniqueProductIds = Array.from(new Set(orderItems.map(item => item.product_id)));
  const { data: productsData, error: productsError } = await supabase
    .from('products')
    .select('id, title')
    .in('id', uniqueProductIds);
    
  const productMap = {};
  if (!productsError && Array.isArray(productsData)) {
    productsData.forEach(product => {
      productMap[product.id] = product.title;
    });
  } else {
    console.error('Error fetching product data:', productsError);
  }

  // Group order items by order ID for the detailed report
  const orderItemsByOrder = {};
  orderItems.forEach(item => {
    if (!orderItemsByOrder[item.order_id]) {
      orderItemsByOrder[item.order_id] = [];
    }
    orderItemsByOrder[item.order_id].push(item);
  });

  // ----------------
  // Generate Excel Report using ExcelJS
  const workbook = new ExcelJS.Workbook();

  // SUMMARY SHEET
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 30 }
  ];
  summarySheet.addRow({ metric: 'Total Orders', value: totalOrders });
  summarySheet.addRow({ metric: 'Total Earnings (₹)', value: totalEarnings.toFixed(2) });
  summarySheet.addRow({ metric: 'Most Ordered Product', value: mostOrderedProductName });
  summarySheet.addRow({ metric: 'Most Liked Category', value: mostLikedCategoryName });

  // DETAILED REPORT SHEET
  const detailedSheet = workbook.addWorksheet('Detailed Report');
  detailedSheet.columns = [
    { header: 'Order ID', key: 'id', width: 10 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Order Date', key: 'created_at', width: 20 },
    { header: 'Delivery Type', key: 'delivery_type', width: 15 },
    { header: 'Order Status', key: 'order_status', width: 15 },
    { header: 'Order Total (₹)', key: 'order_total', width: 15 },
    { header: 'Items', key: 'items', width: 50 }
  ];

  orders.forEach(order => {
    const username = userMap[order.user_id] || 'Unknown';
    const orderDate = order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A';
    const deliveryType = order.delivery_type || 'N/A';
    const orderStatus = order.order_status || 'Pending';
    const items = orderItemsByOrder[order.id] || [];
    let orderTotal = 0;
    const itemsDescriptions = items.map(item => {
      const productTitle = productMap[item.product_id] || 'N/A';
      const itemTotal = parseFloat(item.price) * item.quantity;
      orderTotal += itemTotal;
      return `${productTitle} (Qty: ${item.quantity}, Unit Price: ₹${parseFloat(item.price).toFixed(2)}, Total: ₹${itemTotal.toFixed(2)})`;
    });
    const itemsString = itemsDescriptions.join('; ');
    detailedSheet.addRow({
      id: order.id,
      username,
      created_at: orderDate,
      delivery_type: deliveryType,
      order_status: orderStatus,
      order_total: orderTotal.toFixed(2),
      items: itemsString
    });
  });

  // Generate workbook buffer
  let buffer;
  try {
    buffer = await workbook.xlsx.writeBuffer();
  } catch (excelError) {
    console.error('Error generating Excel buffer:', excelError.message);
    return res.status(500).json({ error: 'Failed to generate report file.' });
  }

  // ----------------
  // Fetch superuser email from superusers table  
  // Instructions: Insert superuser on line 202 and line 234 (using the first superuser record)
  const { data: superuserData, error: superuserError } = await supabase
    .from('superusers')
    .select('id, username, email')
    .limit(1)
    .single();
    
  if (superuserError || !superuserData) {
    console.error('Error fetching superuser email:', superuserError ? superuserError.message : 'No data returned');
    return res.status(500).json({ error: 'Failed to fetch superuser email.' });
  }
  const superuserEmail = superuserData.email;

  // ----------------
  // Configure nodemailer transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_ADDRESS,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  // Prepare mail options with the Excel report attached
  const mailOptions = {
    from: process.env.EMAIL_ADDRESS,
    to: superuserEmail,
    subject: `Comprehensive Orders Report for ${value}`,
    text: `Please find attached a comprehensive orders report for ${value}.
    
This report includes:
- Detailed order information: Order ID, Username, Order Date, Delivery Type, Order Status, Order Total, and Item breakdown.
- A summary section at the beginning with aggregate metrics.`,
    attachments: [
      {
        filename: `Orders_Report_${value}.xlsx`,
        content: buffer,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
  };

  // Send the email with the attached report
  try {
    await transporter.sendMail(mailOptions);
    console.log(`Report email sent to ${superuserEmail} for ${value}`);
    return res.status(200).json({ message: 'Report sent successfully to the superuser email.' });
  } catch (err) {
    console.error(`Error sending email: ${err.message}`);
    return res.status(500).json({ error: 'Failed to send report email.' });
  }
});

module.exports = router;
