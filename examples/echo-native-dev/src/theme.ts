import {StyleSheet} from 'react-native';
export const c={bg:'#F6F8FC',paper:'#FFFFFF',ink:'#182238',muted:'#69758B',primary:'#3854B9',line:'#E0E7F2',cyan:'#E8F3FC'};
export const s=StyleSheet.create({
 page:{flex:1,backgroundColor:c.bg},scroll:{paddingHorizontal:20,paddingTop:22,paddingBottom:35},
 kicker:{color:c.primary,fontSize:13,fontWeight:'700',letterSpacing:1.5},
 heading:{fontSize:28,fontWeight:'800',color:c.ink,marginTop:8,marginBottom:6},
 intro:{fontSize:14,color:c.muted,lineHeight:23,marginBottom:18},
 card:{backgroundColor:c.paper,borderRadius:18,padding:18,marginBottom:12,borderWidth:1,borderColor:c.line},
 tag:{fontSize:12,color:c.primary,fontWeight:'700'},title:{fontSize:19,fontWeight:'700',color:c.ink,marginTop:6},
 body:{fontSize:14,color:c.muted,lineHeight:22,marginTop:8},
 input:{height:48,backgroundColor:c.paper,paddingHorizontal:16,borderWidth:1,borderColor:c.line,borderRadius:14,color:c.ink,marginBottom:18},
 action:{backgroundColor:c.primary,borderRadius:14,alignItems:'center',padding:15,marginTop:14},
 actionText:{color:'#FFFFFF',fontSize:16,fontWeight:'700'},
 disabled:{backgroundColor:'#E1E6EF',borderRadius:14,alignItems:'center',padding:15,marginTop:14},
 disabledText:{color:'#64718A',fontWeight:'600'},
 smallLink:{color:c.primary,fontWeight:'700',fontSize:14,marginTop:14},
 warning:{backgroundColor:c.cyan,padding:14,borderRadius:12,marginTop:14},
 warningText:{color:'#29456F',lineHeight:21,fontSize:13}
});