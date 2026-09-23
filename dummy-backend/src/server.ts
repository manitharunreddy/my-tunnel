import express, { Request, Response } from "express";

const app = express();

const PORT = 5001;

app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Hello from Local API 🚀",
  });
});

app.get("/products", (req: Request, res: Response) => {
  res.json([
    {
      id: 1,
      name: "Laptop",
      price: 50000,
    },
    {
      id: 2,
      name: "Phone",
      price: 20000,
    },
  ]);
});

app.listen(PORT, () => {
  console.log(`🚀 Local API running on http://localhost:${PORT}`);
});
