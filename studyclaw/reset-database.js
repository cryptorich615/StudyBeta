const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetDatabase() {
  console.log('🗑️  Resetting StudyClaw database...');
  
  try {
    // Delete companions (user's AI agents)
    const { error: companionsError } = await supabase
      .from('companions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
    
    if (companionsError) console.log('⚠️  Companions:', companionsError.message);
    else console.log('✅ Cleared companions table');

    // Delete study sessions
    const { error: sessionsError } = await supabase
      .from('study_sessions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (sessionsError) console.log('⚠️  Sessions:', sessionsError.message);
    else console.log('✅ Cleared study_sessions table');

    // Delete student profiles
    const { error: profilesError } = await supabase
      .from('student_profiles')
      .delete()
      .neq('user_id', '00000000-0000-0000-0000-000000000000');
    
    if (profilesError) console.log('⚠️  Profiles:', profilesError.message);
    else console.log('✅ Cleared student_profiles table');

    // Delete subjects
    const { error: subjectsError } = await supabase
      .from('subjects')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (subjectsError) console.log('⚠️  Subjects:', subjectsError.message);
    else console.log('✅ Cleared subjects table');

    // Note: We cannot delete from auth.users via API
    console.log('\n⚠️  Note: Auth users must be deleted manually via Supabase dashboard');
    console.log('   or by clearing browser localStorage/sessionStorage\n');
    
    console.log('✅ Database reset complete!');
    console.log('\n📝 To complete the reset:');
    console.log('   1. Clear browser localStorage (F12 > Application > Local Storage)');
    console.log('   2. Clear browser sessionStorage');
    console.log('   3. Sign up with a new account\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

resetDatabase();
