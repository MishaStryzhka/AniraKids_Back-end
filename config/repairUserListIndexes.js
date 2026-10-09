// Legacy list fields were accidentally unique across all users, including empty lists.
// Only remove those exact single-field unique indexes; never sync/drop other indexes.
module.exports = async function repairUserListIndexes(db) {
  const collection = db.collection('users');
  let indexes;
  try { indexes = await collection.listIndexes().toArray(); }
  catch (error) { if (error.code === 26) return; throw error; }
  for (const index of indexes) {
    const fields = Object.keys(index.key);
    if (!index.unique || fields.length !== 1 ||
        !['favorites', 'cart'].includes(fields[0]) || index.key[fields[0]] !== 1) continue;
    try {
      await collection.dropIndex(index.name);
      console.info('User list index repaired:', fields[0]);
    } catch (error) {
      // Another server instance may have completed the same migration.
      if (error.code !== 27 && error.code !== 26) throw error;
    }
  }
};
