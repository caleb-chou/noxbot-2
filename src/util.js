const ADMIN_PERMISSION = 0x00000008;

export function isAdmin(interaction) {
  console.log(`Member ${interaction.member}`);
  console.log(interaction.guild)
  return true
  // if (!interaction.member || !interaction.member.permissions) return false;

  // const perms = BigInt(interaction.member.permissions);
  // console.log(perms)
  // return (perms & BigInt(ADMIN_PERMISSION)) === BigInt(ADMIN_PERMISSION);
}