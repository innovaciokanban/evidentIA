export type UserOption = { id: string; name: string; isActive?: boolean }

export const activeUserOptions = <T extends UserOption>(users: T[], historical: T[] = []): T[] => {
  const options = users.filter((user) => user.isActive !== false)
  for (const user of historical) {
    if (user.isActive === false && !options.some((option) => option.id === user.id)) options.push(user)
  }
  return options
}

export const userOptionLabel = (user: UserOption) => user.isActive === false ? `${user.name} (Inactivo)` : user.name
