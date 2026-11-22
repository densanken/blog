export default defineEventHandler((event) => getAuthor(event, getRouterParam(event, "id") ?? ""));
