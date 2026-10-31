process.env.SCYLLA_PROVIDER ||= 'mock';
process.env.PORT ||= '4100';

await import('./index.js');
