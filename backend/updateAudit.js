import fs from 'fs';
import path from 'path';

const routesDir = path.join(process.cwd(), 'src', 'routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

files.forEach(file => {
  const filePath = path.join(routesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace exactly 'logAudit({' with 'logAudit({ req,'
  // This will safely prepend req to the params object
  content = content.replace(/logAudit\(\{/g, 'logAudit({ req,');
  
  fs.writeFileSync(filePath, content, 'utf8');
});
console.log('Done updating logAudit calls in routes.');
