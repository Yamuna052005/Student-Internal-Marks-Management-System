import mongoose from "mongoose";
import dns from "node:dns";

// Fix for querySrv ECONNREFUSED in environments where the router DNS
// fails to resolve MongoDB Atlas SRV records properly.
dns.setServers(['8.8.8.8', '8.8.4.4']);

export async function connectDb(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    dbName: 'wsimms'
  });
  return mongoose.connection;
}
