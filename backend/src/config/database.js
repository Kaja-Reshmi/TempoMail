
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error:", error);
});

export async function connectDatabase() {
  const result = await pool.query("SELECT NOW() AS current_time");

  console.log(
    "PostgreSQL connected:",
    result.rows[0].current_time
  );

  return result;
}
