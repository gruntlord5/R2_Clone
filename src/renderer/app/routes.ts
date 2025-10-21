import {
  type RouteConfig,
  route,
  index,
} from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

export default async function routes() {
  return [
    // Root layout is already handled by React Router
    // You can mix explicit routes with file-based routes
    
    // Use flat routes for file-based routing convention
    ...(await flatRoutes({
      rootDirectory: "src/renderer/app/routes",
    })),
    
    // You can also add explicit routes if needed
    // route("custom-path", "./custom-module.tsx"),
  ] satisfies RouteConfig;
}