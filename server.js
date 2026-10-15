import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// Serve frontend files
app.use(express.static("public"));

// Basic API health check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        message: "VAuLT Gateway is running!"
    });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Gateway running on port ${PORT}`);
});
